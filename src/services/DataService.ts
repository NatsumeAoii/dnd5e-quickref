import { CONFIG } from '../config.js';
import { DataLoadError } from '../utils/Utils.js';
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

export class DataService {
    #stateManager: StateManager;
    #fetchPromises = new Map<string, Promise<void>>();
    // #1: Persistent cache so ruleset switches don't re-fetch+re-parse
    #dataCache = new Map<string, RuleData[]>();

    constructor(stateManager: StateManager) { this.#stateManager = stateManager; }

    #getRulesetKey = (is2024: boolean): string => (is2024 ? '2024' : '2014');

    getDataSourceKey = (key: string): string => (key.startsWith('environment_') ? 'environment' : key);

    async #fetchWithRetry(url: string, retries = 3, backoff = 500): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (response.ok) return response;
            if (retries > 0 && (response.status >= 500 || response.status === 429)) {
                throw new Error(`Server error: ${response.status}`);
            }
            return response;
        } catch (error) {
            if (isAbortError(error)) throw error;
            if (retries === 0) throw error;
            const jitter = Math.floor(Math.random() * Math.min(100, backoff * 0.2));
            const delay = backoff + jitter;
            console.warn(`Fetch failed for ${url}. Retrying in ${delay}ms... (${retries} attempts left)`);
            await new Promise<void>((resolve) => { setTimeout(resolve, delay); });
            return this.#fetchWithRetry(url, retries - 1, backoff * 2);
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    // #15: Validate and sanitize parsed rule data
    // (G) Avoids JSON.stringify per entry — iterates string fields directly + deep-checks bullets
    #validateData(data: unknown): RuleData[] {
        if (!Array.isArray(data)) return [];
        return (data as RuleData[]).filter((entry) => {
            if (!entry || typeof entry !== 'object' || typeof entry.title !== 'string') return false;
            if (entry.optional !== undefined && !ALLOWED_RULE_TYPES.has(entry.optional)) {
                console.warn(`Stripped rule entry with invalid rule type: "${entry.title}"`);
                return false;
            }
            if (entry.icon !== undefined && typeof entry.icon !== 'string') return false;
            // Check all string-valued top-level properties for dangerous patterns
            for (const val of Object.values(entry)) {
                if (typeof val === 'string' && DANGEROUS_DATA_RE.test(val)) {
                    console.warn(`Stripped potentially dangerous rule entry: "${entry.title}"`);
                    return false;
                }
            }
            // Deep-check bullets array: content, items[], headers[], rows[][]
            if (Array.isArray(entry.bullets)) {
                for (const bullet of entry.bullets) {
                    if (!isValidBulletShape(bullet)) {
                        console.warn(`Stripped rule entry with malformed bullet data: "${entry.title}"`);
                        return false;
                    }
                    const stringsToCheck: string[] = [];
                    if (typeof bullet.content === 'string') stringsToCheck.push(bullet.content);
                    if (Array.isArray(bullet.items)) stringsToCheck.push(...bullet.items.filter((s: unknown): s is string => typeof s === 'string'));
                    if (Array.isArray(bullet.headers)) stringsToCheck.push(...bullet.headers.filter((s: unknown): s is string => typeof s === 'string'));
                    if (Array.isArray(bullet.rows)) {
                        for (const row of bullet.rows) {
                            if (Array.isArray(row)) stringsToCheck.push(...row.filter((s: unknown): s is string => typeof s === 'string'));
                        }
                    }
                    if (stringsToCheck.some((s) => DANGEROUS_DATA_RE.test(s))) {
                        console.warn(`Stripped potentially dangerous rule entry: "${entry.title}"`);
                        return false;
                    }
                }
            }
            return true;
        });
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
        const state = this.#stateManager.getState();
        if (state.data.loadedRulesets[rulesetKey].has(dataFileName)) return;

        const cacheKey = `${rulesetKey}_${dataFileName}`;
        if (this.#fetchPromises.has(cacheKey)) return this.#fetchPromises.get(cacheKey);

        // #1: Check persistent data cache before fetching
        const cached = this.#dataCache.get(cacheKey);
        if (cached) {
            state.data.rulesets[rulesetKey][dataFileName] = cached;
            state.data.loadedRulesets[rulesetKey].add(dataFileName);
            return;
        }

        const prefix = rulesetKey === '2024' ? '2024_' : '';
        const path = `js/data/${prefix}data_${dataFileName}.json?v=${CONFIG.APP_VERSION}`;

        const promise = (async () => {
            try {
                const res = await this.#fetchWithRetry(path);
                if (!res.ok) throw new DataLoadError(path, `HTTP ${res.status}`);
                const raw = await this.#readJsonResponse(res, path);
                const validated = this.#validateData(raw);
                state.data.rulesets[rulesetKey][dataFileName] = validated;
                this.#dataCache.set(cacheKey, validated);
                state.data.loadedRulesets[rulesetKey].add(dataFileName);
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
        const run = async (): Promise<void> => {
            while (idx < tasks.length) {
                const taskIdx = idx++;
                try { await tasks[taskIdx](); } catch { /* errors logged in #loadDataFile */ }
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
                        const bulletParts: string[] = [];
                        rule.bullets?.forEach((bullet) => {
                            if (bullet.content) bulletParts.push(bullet.content);
                            if (Array.isArray(bullet.items)) bulletParts.push(...bullet.items);
                            if (Array.isArray(bullet.headers)) bulletParts.push(...bullet.headers);
                            if (Array.isArray(bullet.rows)) {
                                bullet.rows.forEach((row) => bulletParts.push(...row.map((cell) => String(cell ?? ''))));
                            }
                        });
                        state.data.ruleMap.set(id, {
                            ruleData: rule,
                            type: section.type,
                            sectionId: section.id,
                            searchIndex: [
                                rule.title,
                                rule.description,
                                rule.subtitle,
                                rule.summary,
                                rule.reference,
                                ...bulletParts,
                            ].map(normalizeSearchPart).join('\0'),
                        });
                    }
                });
            }
        });
    }

    // #5: Persistent linker data cache keyed by ruleset
    #linkerDataCache = new Map<string, { regex: RegExp | null; titleLookup: Map<string, string>; titleHash: string }>();

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
            return;
        }

        state.data.titleLookup = titleLookup;
        const uniqueTitles = [...new Set(ruleTitles)].sort((a, b) => b.length - a.length);

        // Guard: empty pattern would match empty strings and cause infinite loops in matchAll
        if (uniqueTitles.length === 0) {
            state.data.ruleLinkerRegex = null;
            this.#linkerDataCache.set(rulesetKey, { regex: null, titleLookup, titleHash });
            return;
        }

        const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<![\\p{L}\\p{N}_])(${uniqueTitles.map(esc).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
        state.data.ruleLinkerRegex = regex;
        this.#linkerDataCache.set(rulesetKey, { regex, titleLookup, titleHash });
    }
}
