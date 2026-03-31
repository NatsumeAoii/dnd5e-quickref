import { CONFIG } from '../config.js';
import { DataLoadError } from '../utils/Utils.js';
import type { StateManager } from '../state/StateManager.js';
import type { RuleData } from '../types.js';

// #15: Pattern for detecting potentially malicious content in data entries
const DANGEROUS_DATA_RE = /<script[\s>]|onerror\s*=|javascript:/i;

export class DataService {
    #stateManager: StateManager;
    #fetchPromises = new Map<string, Promise<void>>();
    // #1: Persistent cache so ruleset switches don't re-fetch+re-parse
    #dataCache = new Map<string, RuleData[]>();

    constructor(stateManager: StateManager) { this.#stateManager = stateManager; }

    #getRulesetKey = (is2024: boolean): string => (is2024 ? '2024' : '2014');

    getDataSourceKey = (key: string): string => (key.startsWith('environment_') ? 'environment' : key);

    async #fetchWithRetry(url: string, retries = 3, backoff = 500): Promise<Response> {
        try {
            const response = await fetch(url);
            if (response.ok) return response;
            if (retries > 0 && (response.status >= 500 || response.status === 429)) {
                throw new Error(`Server error: ${response.status}`);
            }
            return response;
        } catch (error) {
            if (retries === 0) throw error;
            console.warn(`Fetch failed for ${url}. Retrying in ${backoff}ms... (${retries} attempts left)`);
            await new Promise<void>((resolve) => { setTimeout(resolve, backoff); });
            return this.#fetchWithRetry(url, retries - 1, backoff * 2);
        }
    }

    // #15: Validate and sanitize parsed rule data
    // (G) Avoids JSON.stringify per entry — iterates string fields directly + deep-checks bullets
    #validateData(data: unknown): RuleData[] {
        if (!Array.isArray(data)) return [];
        return (data as RuleData[]).filter((entry) => {
            if (!entry || typeof entry !== 'object' || typeof entry.title !== 'string') return false;
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
                    if (!bullet || typeof bullet !== 'object') continue;
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
                const raw = await res.json();
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
        console.log('Starting background preload of all data files...');
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
        console.log('All data files preloaded.');
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
                src.forEach((rule) => {
                    if (rule.title) {
                        const id = `${section.type}::${rule.title}`;
                        const existing = state.data.ruleMap.get(id);
                        if (existing && existing.ruleData !== rule) {
                            console.warn(`Duplicate rule key "${id}" in section "${section.id}" — previous entry overwritten.`);
                        }
                        const titlePart = rule.title.toLowerCase();
                        const descPart = (rule.description ?? '').replace(/<[^>]*>/g, '').toLowerCase();
                        const subtitlePart = (rule.subtitle ?? '').toLowerCase();
                        state.data.ruleMap.set(id, {
                            ruleData: rule,
                            type: section.type,
                            sectionId: section.id,
                            searchIndex: `${titlePart}\0${descPart}\0${subtitlePart}`,
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

        state.data.ruleMap.forEach((_info, key) => {
            const title = key.split('::')[1];
            if (title && title.length > 2) {
                ruleTitles.push(title);
                titleLookup.set(title.toLowerCase(), key);
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
        const regex = new RegExp(`\\b(${uniqueTitles.map(esc).join('|')})\\b`, 'gi');
        state.data.ruleLinkerRegex = regex;
        this.#linkerDataCache.set(rulesetKey, { regex, titleLookup, titleHash });
    }
}
