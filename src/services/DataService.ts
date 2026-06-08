import { CONFIG } from '../config.js';
import { DataLoadError, fetchWithTimeout } from '../utils/Utils.js';
import { TrieMatcher } from '../utils/TrieMatcher.js';
import type { StateManager } from '../state/StateManager.js';
import type { RuleData } from '../types.js';

const DANGEROUS_DATA_RE = /<script[\s>]|on\w+\s*=|javascript:/i;
const FETCH_TIMEOUT_MS = 10_000;
const JSON_CONTENT_TYPE_RE = /\bjson\b/i;
const ALLOWED_RULE_TYPES = new Set(['Standard rule', 'Optional rule', 'Homebrew rule']);
const ALLOWED_BULLET_TYPES = new Set(['paragraph', 'list', 'table']);

const stripMarkup = (value: string): string => value.replace(/<[^>]*>/g, ' ');
const normalizeSearchPart = (value: string | number | null | undefined): string =>
    stripMarkup(String(value ?? '')).toLowerCase();
const isAbortError = (error: unknown): boolean =>
    error instanceof DOMException && error.name === 'AbortError';
const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');
const isTableCell = (value: unknown): value is string | number | null =>
    value === null || typeof value === 'string' || typeof value === 'number';
const isValidBulletShape = (bullet: unknown): boolean => {
    if (!bullet || typeof bullet !== 'object') return false;
    const raw = bullet as Record<string, unknown>;
    if (typeof raw.type !== 'string' || !ALLOWED_BULLET_TYPES.has(raw.type)) return false;
    if (raw.content !== undefined && typeof raw.content !== 'string') return false;
    if (raw.items !== undefined && !isStringArray(raw.items)) return false;
    if (raw.headers !== undefined && !isStringArray(raw.headers)) return false;
    if (raw.rows !== undefined) {
        if (!Array.isArray(raw.rows)) return false;
        const headerCount = Array.isArray(raw.headers) ? raw.headers.length : null;
        for (const row of raw.rows) {
            if (!Array.isArray(row)) return false;
            if (headerCount !== null && row.length !== headerCount) return false;
            if (!row.every(isTableCell)) return false;
        }
    }
    return true;
};

/**
 * Exported for property-based testing. Validates and sanitizes parsed rule data:
 * - Filters non-array inputs to empty array
 * - Requires title to be a string
 * - Rejects entries with invalid optional rule types
 * - Rejects entries with non-string icon when icon is present
 * - Rejects entries with dangerous content patterns in any string field
 * - Rejects entries with malformed bullet shapes
 * - Rejects entries with dangerous content inside bullets
 */
export function validateData(data: unknown): RuleData[] {
    if (!Array.isArray(data)) return [];
    return (data as RuleData[]).filter((entry) => {
        if (!entry || typeof entry !== 'object' || typeof entry.title !== 'string') return false;
        if (entry.optional !== undefined && !ALLOWED_RULE_TYPES.has(entry.optional)) return false;
        if (entry.icon !== undefined && typeof entry.icon !== 'string') return false;
        for (const val of Object.values(entry)) {
            if (typeof val === 'string' && DANGEROUS_DATA_RE.test(val)) return false;
        }
        if (Array.isArray(entry.bullets)) {
            for (const bullet of entry.bullets) {
                if (!isValidBulletShape(bullet)) return false;
                const stringsToCheck: string[] = [];
                if (typeof bullet.content === 'string') stringsToCheck.push(bullet.content);
                if (Array.isArray(bullet.items)) stringsToCheck.push(...bullet.items.filter((s: unknown): s is string => typeof s === 'string'));
                if (Array.isArray(bullet.headers)) stringsToCheck.push(...bullet.headers.filter((s: unknown): s is string => typeof s === 'string'));
                if (Array.isArray(bullet.rows)) {
                    for (const row of bullet.rows) {
                        if (Array.isArray(row)) stringsToCheck.push(...row.filter((s: unknown): s is string => typeof s === 'string'));
                    }
                }
                if (stringsToCheck.some((s) => DANGEROUS_DATA_RE.test(s))) return false;
            }
        }
        return true;
    });
}

/** TTL duration for retaining previous locale cache entries (5 minutes) */
const LOCALE_CACHE_TTL_MS = 5 * 60 * 1000;

export class DataService {
    #stateManager: StateManager;
    #fetchPromises = new Map<string, Promise<void>>();
    // #1: Persistent cache so ruleset switches don't re-fetch+re-parse
    #dataCache = new Map<string, RuleData[]>();
    /** Tracks cache keys scheduled for TTL-based eviction: key → expiry timestamp */
    #pendingEvictions = new Map<string, number>();
    /** Active timer for scheduled eviction cleanup */
    #evictionTimerId: ReturnType<typeof setTimeout> | null = null;

    constructor(stateManager: StateManager) {
        this.#stateManager = stateManager;
        // Subscribe to locale changes for TTL-based cache eviction
        if (typeof this.#stateManager.subscribe === 'function') {
            this.#stateManager.subscribe('settingChanged', (data?: unknown) => {
                const { key, value } = data as { key: string; value: string };
                if (key === 'LOCALE') this.#scheduleLocaleEviction(value);
            });
        }
    }

    /**
     * When locale switches, mark all cache entries for the previous locale
     * with a 5-minute TTL. Schedule cleanup via setTimeout.
     * If switching back to a locale that has pending evictions, cancel those evictions.
     */
    #scheduleLocaleEviction(newLocale: string): void {
        const now = Date.now();
        const expiresAt = now + LOCALE_CACHE_TTL_MS;

        // Cancel any pending evictions for the new locale (user switched back quickly)
        for (const cacheKey of [...this.#pendingEvictions.keys()]) {
            const entryLocale = cacheKey.split('_')[0];
            if (entryLocale === newLocale) {
                this.#pendingEvictions.delete(cacheKey);
            }
        }

        // Mark all cache entries not belonging to the new locale for eviction
        for (const cacheKey of this.#dataCache.keys()) {
            const entryLocale = cacheKey.split('_')[0];
            if (entryLocale !== newLocale && !this.#pendingEvictions.has(cacheKey)) {
                this.#pendingEvictions.set(cacheKey, expiresAt);
            }
        }

        // Schedule cleanup after TTL expires
        this.#scheduleEvictionTimer();
    }

    /** Schedule a single setTimeout that fires after the earliest pending eviction expires */
    #scheduleEvictionTimer(): void {
        if (this.#evictionTimerId !== null) {
            clearTimeout(this.#evictionTimerId);
            this.#evictionTimerId = null;
        }
        if (this.#pendingEvictions.size === 0) return;

        const now = Date.now();
        let earliestExpiry = Infinity;
        for (const expiry of this.#pendingEvictions.values()) {
            if (expiry < earliestExpiry) earliestExpiry = expiry;
        }

        const delay = Math.max(0, earliestExpiry - now);
        this.#evictionTimerId = setTimeout(() => {
            this.#evictionTimerId = null;
            this.#runEvictionCleanup();
        }, delay);
    }

    /** Evict all expired cache entries and reschedule if any remain */
    #runEvictionCleanup(): void {
        const now = Date.now();
        for (const [cacheKey, expiresAt] of this.#pendingEvictions) {
            if (now >= expiresAt) {
                this.#dataCache.delete(cacheKey);
                this.#pendingEvictions.delete(cacheKey);
            }
        }
        // Reschedule if there are still pending evictions that haven't expired yet
        if (this.#pendingEvictions.size > 0) {
            this.#scheduleEvictionTimer();
        }
    }

    /** Run eviction cleanup check on data access — evicts expired entries */
    #checkEvictions(): void {
        if (this.#pendingEvictions.size === 0) return;
        this.#runEvictionCleanup();
    }

    #getRulesetKey = (is2024: boolean): string => (is2024 ? '2024' : '2014');

    #getLocaleKey = (): string => {
        const { locale } = this.#stateManager.getState().settings;
        return CONFIG.LOCALE_CONFIG.SUPPORTED.some((supportedLocale) => supportedLocale === locale)
            ? locale
            : CONFIG.DEFAULTS.LOCALE;
    };

    getDataSourceKey = (key: string): string => (key.startsWith('environment_') ? 'environment' : key);

    async #fetchWithRetry(url: string, retries = 3, backoff = 500): Promise<Response> {
        try {
            const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
            if (response.ok) return response;
            // Transient errors (5xx or 429): throw to trigger retry logic below
            if (retries > 0 && (response.status >= 500 || response.status === 429)) {
                throw new Error(`Server error: ${response.status}`);
            }
            // Non-transient errors (4xx except 429): fail immediately
            return response;
        } catch (error) {
            if (isAbortError(error)) throw error;
            if (retries === 0) throw error;
            // Exponential backoff with jitter within 20% of current delay
            const jitter = Math.floor(Math.random() * backoff * 0.2);
            const delay = backoff + jitter;
            console.warn(`Fetch failed for ${url}. Retrying in ${delay}ms... (${retries} attempts left)`);
            await new Promise<void>((resolve) => { setTimeout(resolve, delay); });
            return this.#fetchWithRetry(url, retries - 1, backoff * 2);
        }
    }

    // #15: Validate and sanitize parsed rule data — delegates to the shared exported function
    // and logs warnings for stripped entries in non-test contexts.
    #validateData(data: unknown): RuleData[] {
        if (!Array.isArray(data)) return [];
        const before = data.length;
        const validated = validateData(data);
        if (validated.length < before) {
            console.warn(`Data validation stripped ${before - validated.length} invalid or dangerous rule entries.`);
        }
        return validated;
    }

    async #readJsonResponse(res: Response, path: string): Promise<unknown> {
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType && !JSON_CONTENT_TYPE_RE.test(contentType)) {
            const text = await res.text();
            try {
                return JSON.parse(text) as unknown;
            } catch {
                throw new DataLoadError(path, `Expected JSON response, received ${contentType}`);
            }
        }
        try {
            return await res.json();
        } catch (error) {
            throw new DataLoadError(path, error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON');
        }
    }

    async #loadDataFile(dataFileName: string, rulesetKey: string): Promise<void> {
        // Run eviction cleanup on data access to remove expired locale cache entries
        this.#checkEvictions();

        const state = this.#stateManager.getState();
        const localeKey = this.#getLocaleKey();
        const loadedKey = `${localeKey}:${dataFileName}`;

        const cacheKey = `${localeKey}_${rulesetKey}_${dataFileName}`;
        const cached = this.#dataCache.get(cacheKey);
        if (cached) {
            state.data.rulesets[rulesetKey][dataFileName] = cached;
            state.data.loadedRulesets[rulesetKey].add(loadedKey);
            return;
        }
        if (state.data.loadedRulesets[rulesetKey].has(loadedKey)) return;
        if (this.#fetchPromises.has(cacheKey)) return this.#fetchPromises.get(cacheKey);

        const prefix = rulesetKey === '2024' ? '2024_' : '';
        const path = `${CONFIG.LOCALE_CONFIG.PATH}${localeKey}/rules/${prefix}data_${dataFileName}.json?v=${CONFIG.APP_VERSION}`;

        const promise = (async () => {
            try {
                const res = await this.#fetchWithRetry(path);
                if (!res.ok) throw new DataLoadError(path, `HTTP ${res.status}`);
                const raw = await this.#readJsonResponse(res, path);
                const validated = this.#validateData(raw);
                state.data.rulesets[rulesetKey][dataFileName] = validated;
                this.#dataCache.set(cacheKey, validated);
                state.data.loadedRulesets[rulesetKey].add(loadedKey);
            } catch (e) {
                console.error(`Data load failed for ${dataFileName} (${rulesetKey}):`, e);
                state.data.rulesets[rulesetKey][dataFileName] = [];
                throw e;
            } finally {
                this.#fetchPromises.delete(cacheKey);
            }
        })();

        this.#fetchPromises.set(cacheKey, promise);
        return promise;
    }

    async ensureSectionDataLoaded(dataFileName: string): Promise<void> {
        const { use2024Rules } = this.#stateManager.getState().settings;
        await this.#loadDataFile(dataFileName, this.#getRulesetKey(use2024Rules));
    }

    async ensureAllDataLoadedForActiveRuleset(): Promise<void> {
        const { use2024Rules } = this.#stateManager.getState().settings;
        const rulesetKey = this.#getRulesetKey(use2024Rules);
        const localeKey = this.#getLocaleKey();

        // Fast path: if all data files are already in the in-memory cache, resolve without
        // initiating any network requests or per-file overhead (Requirement 10.4)
        const allCached = CONFIG.DATA_FILES.every(
            (file) => this.#dataCache.has(`${localeKey}_${rulesetKey}_${file}`)
        );
        if (allCached) {
            const state = this.#stateManager.getState();
            for (const file of CONFIG.DATA_FILES) {
                const cacheKey = `${localeKey}_${rulesetKey}_${file}`;
                state.data.rulesets[rulesetKey][file] = this.#dataCache.get(cacheKey)!;
                state.data.loadedRulesets[rulesetKey].add(`${localeKey}:${file}`);
            }
            return;
        }

        await Promise.all(CONFIG.DATA_FILES.map((file) => this.#loadDataFile(file, rulesetKey)));
    }

    // #7: Concurrency-limited preload (batch of 4) to avoid browser connection saturation
    async preloadAllDataSilent(): Promise<void> {
        console.info('Starting background preload of all data files...');
        const tasks: (() => Promise<void>)[] = [];
        (['2014', '2024'] as const).forEach((ruleset) => {
            CONFIG.DATA_FILES.forEach((file) => tasks.push(() => this.#loadDataFile(file, ruleset)));
        });

        const concurrency = 4;
        let idx = 0;
        // Yield scheduling opportunity to the main thread between task completions
        const yieldToMain = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
        const run = async (): Promise<void> => {
            while (idx < tasks.length) {
                const taskIdx = idx++;
                try { await tasks[taskIdx](); } catch { /* errors logged in #loadDataFile */ }
                // Yield between batch completions so the main thread can handle user interactions
                await yieldToMain();
            }
        };
        await Promise.allSettled(Array.from({ length: Math.min(concurrency, tasks.length) }, () => run()));
        console.info('All data files preloaded.');
    }

    buildRuleMap(): void {
        const state = this.#stateManager.getState();
        const { use2024Rules } = state.settings;
        const rulesetKey = this.#getRulesetKey(use2024Rules);
        const activeRulesetData = state.data.rulesets[rulesetKey];
        state.data.ruleMap.clear();

        CONFIG.SECTION_CONFIG.forEach((section) => {
            const srcKey = this.getDataSourceKey(section.dataKey);
            const src = activeRulesetData[srcKey];
            if (Array.isArray(src)) {
                const rules = section.dataKey.startsWith('environment_')
                    ? src.filter((rule) => rule.tags?.includes(section.dataKey))
                    : src;
                rules.forEach((rule) => {
                    if (rule.title) {
                        const id = `${section.type}::${rule.title}`;
                        if (state.data.ruleMap.has(id)) {
                            console.warn(`Duplicate rule id "${id}" while building rule map; later entry overwrites earlier entry.`);
                        }
                        // #1: Defer search index construction — store rule immediately, build index lazily
                        state.data.ruleMap.set(id, {
                            ruleData: rule,
                            type: section.type,
                            sectionId: section.id,
                            searchIndex: undefined,
                        });
                    }
                });
            }
        });

        // #1: Build search indices in idle time to avoid blocking the main thread
        this.#buildSearchIndicesDeferred();
    }

    #searchIndexBuildPending = false;

    #buildSearchIndicesDeferred(): void {
        if (this.#searchIndexBuildPending) return;
        this.#searchIndexBuildPending = true;
        const idleCallback = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
            ?? ((cb: () => void) => setTimeout(cb, 16));
        idleCallback(() => {
            this.#buildSearchIndicesSync();
            this.#searchIndexBuildPending = false;
        });
    }

    #buildSearchIndicesSync(): void {
        const state = this.#stateManager.getState();
        state.data.ruleMap.forEach((info, _id) => {
            if (info.searchIndex !== undefined) return;
            const rule = info.ruleData;
            const bulletParts: string[] = [];
            rule.bullets?.forEach((bullet) => {
                if (bullet.content) bulletParts.push(bullet.content);
                if (Array.isArray(bullet.items)) bulletParts.push(...bullet.items);
                if (Array.isArray(bullet.headers)) bulletParts.push(...bullet.headers);
                if (Array.isArray(bullet.rows)) {
                    bullet.rows.forEach((row) => bulletParts.push(...row.map((cell) => String(cell ?? ''))));
                }
            });
            info.searchIndex = [
                rule.title,
                rule.description,
                rule.subtitle,
                rule.summary,
                rule.reference,
                ...bulletParts,
            ].map(normalizeSearchPart).join('\0');
        });
    }

    /** Ensure search indices are built synchronously (called before search operations) */
    ensureSearchIndicesReady(): void {
        this.#buildSearchIndicesSync();
    }

    // #5: Persistent linker data cache keyed by ruleset
    #linkerDataCache = new Map<string, { regex: RegExp | null; trie: TrieMatcher | null; titleLookup: Map<string, string>; titleHash: string }>();

    buildLinkerData(): void {
        const state = this.#stateManager.getState();
        const rulesetKey = this.#getRulesetKey(state.settings.use2024Rules);
        const titleLookup = new Map<string, string>();
        const ruleTitles: string[] = [];
        const addTitleAlias = (title: string, key: string): void => {
            const normalized = title.trim();
            if (normalized.length <= 2) return;
            ruleTitles.push(normalized);
            const lookupKey = normalized.toLowerCase();
            if (!titleLookup.has(lookupKey)) titleLookup.set(lookupKey, key);
        };

        state.data.ruleMap.forEach((_info, key) => {
            const title = key.split('::')[1];
            if (title) {
                addTitleAlias(title, key);
                const titleWithoutRuleMarker = title.replace(/\*+$/u, '').trim();
                if (titleWithoutRuleMarker !== title) addTitleAlias(titleWithoutRuleMarker, key);
            }
        });

        // Simple hash to detect whether titles changed
        const titleHash = ruleTitles.sort().join('|');
        const cached = this.#linkerDataCache.get(rulesetKey);
        if (cached && cached.titleHash === titleHash) {
            state.data.titleLookup = cached.titleLookup;
            state.data.ruleLinkerRegex = cached.regex;
            state.data.ruleLinkerTrie = cached.trie;
            return;
        }

        state.data.titleLookup = titleLookup;
        const uniqueTitles = [...new Set(ruleTitles)].sort((a, b) => b.length - a.length);

        // Guard: empty pattern would match empty strings and cause infinite loops in matchAll
        if (uniqueTitles.length === 0) {
            state.data.ruleLinkerRegex = null;
            state.data.ruleLinkerTrie = null;
            this.#linkerDataCache.set(rulesetKey, { regex: null, trie: null, titleLookup, titleHash });
            return;
        }

        const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<![\\p{L}\\p{N}_])(${uniqueTitles.map(esc).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
        state.data.ruleLinkerRegex = regex;

        // #2: Build trie-based matcher for O(n) text scanning
        const trie = new TrieMatcher();
        uniqueTitles.forEach((title) => trie.addPattern(title));
        trie.build();
        state.data.ruleLinkerTrie = trie;

        this.#linkerDataCache.set(rulesetKey, { regex, trie, titleLookup, titleHash });
    }
}
