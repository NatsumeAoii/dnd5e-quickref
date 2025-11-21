/* eslint-disable no-console */
import { CONFIG } from './Config.js';
import { DataLoadError } from './Utils.js';

export class DataService {
  #stateManager;

  #fetchPromises = new Map();

  constructor(stateManager) { this.#stateManager = stateManager; }

  #getRulesetKey = (is2024) => (is2024 ? '2024' : '2014');

  getDataSourceKey = (key) => (key.startsWith('environment_') ? 'environment' : key);

  async #fetchWithRetry(url, retries = 3, backoff = 500) {
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
      await new Promise((resolve) => { setTimeout(resolve, backoff); });
      return this.#fetchWithRetry(url, retries - 1, backoff * 2);
    }
  }

  async #loadDataFile(dataFileName, rulesetKey) {
    const state = this.#stateManager.getState();
    if (state.data.loadedRulesets[rulesetKey].has(dataFileName)) return;

    const cacheKey = `${rulesetKey}_${dataFileName}`;
    if (this.#fetchPromises.has(cacheKey)) return this.#fetchPromises.get(cacheKey);

    const prefix = rulesetKey === '2024' ? '2024_' : '';
    const path = `js/data/${prefix}data_${dataFileName}.json?v=2`;

    const promise = (async () => {
      try {
        const res = await this.#fetchWithRetry(path);
        if (!res.ok) throw new DataLoadError(path, `HTTP ${res.status}`);
        state.data.rulesets[rulesetKey][dataFileName] = await res.json();
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

  async ensureSectionDataLoaded(dataFileName) {
    const { use2024Rules } = this.#stateManager.getState().settings;
    await this.#loadDataFile(dataFileName, this.#getRulesetKey(use2024Rules));
  }

  async ensureAllDataLoadedForActiveRuleset() {
    const { use2024Rules } = this.#stateManager.getState().settings;
    const rulesetKey = this.#getRulesetKey(use2024Rules);
    // Load sequentially to prevent potential rate limiting or 503 errors
    for (const file of CONFIG.DATA_FILES) {
      await this.#loadDataFile(file, rulesetKey);
    }
  }

  async preloadAllDataSilent() {
    console.log('Starting background preload of all data files...');
    const promises = [];
    ['2014', '2024'].forEach((ruleset) => {
      CONFIG.DATA_FILES.forEach((file) => promises.push(this.#loadDataFile(file, ruleset)));
    });
    try { await Promise.allSettled(promises); console.log('All data files preloaded.'); } catch (err) { console.error('Background preload encountered errors:', err); }
  }

  buildRuleMap() {
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
            state.data.ruleMap.set(id, { ruleData: rule, type: section.type, sectionId: section.id });
          }
        });
      }
    });
  }

  buildLinkerData() {
    const state = this.#stateManager.getState();
    const ruleTitles = [...state.data.ruleMap.keys()].map((k) => k.split('::')[1]);
    const uniqueTitles = [...new Set(ruleTitles.filter((t) => t.length > 2))].sort((a, b) => b.length - a.length);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    state.data.ruleLinkerRegex = new RegExp(`\\b(${uniqueTitles.map(esc).join('|')})\\b`, 'gi');
  }
}
