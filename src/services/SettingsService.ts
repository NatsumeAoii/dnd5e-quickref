import { CONFIG } from '../config.js';
import type { StateManager } from '../state/StateManager.js';
import type { SyncService } from './SyncService.js';
import type { PerformanceOptimizer } from './PerformanceOptimizer.js';

const ALLOWED_DENSITIES = new Set(['normal', 'compact', 'comfortable']);
const SAFE_THEME_ID_RE = /^[a-z0-9_-]{1,64}$/i;

export class SettingsService {
    #storage: Storage;
    #stateManager: StateManager;
    #syncService: SyncService;
    #optimizer: PerformanceOptimizer;

    constructor(storage: Storage, stateManager: StateManager, syncService: SyncService, optimizer: PerformanceOptimizer) {
        this.#storage = storage;
        this.#stateManager = stateManager;
        this.#syncService = syncService;
        this.#optimizer = optimizer;
    }

    #read = (key: string): string | null => {
        try {
            return this.#storage.getItem(key);
        } catch (e) {
            console.warn(`Failed to read setting "${key}":`, e);
            return null;
        }
    };

    #readBool = (key: string): boolean => this.#read(key) === 'true';

    #readTheme = (key: string, def: string): string => {
        const value = this.#read(key);
        return value && SAFE_THEME_ID_RE.test(value) ? value : def;
    };

    #readDensity = (key: string, def: string): string => {
        const value = this.#read(key);
        return value && ALLOWED_DENSITIES.has(value) ? value : def;
    };

    #isValidValue(key: string, type: 'checkbox' | 'select', value: boolean | string): boolean {
        if (type === 'checkbox') return typeof value === 'boolean';
        if (typeof value !== 'string') return false;
        if (key === 'DENSITY') return ALLOWED_DENSITIES.has(value);
        if (key === 'THEME') return SAFE_THEME_ID_RE.test(value);
        return true;
    }

    initialize(): void {
        const state = this.#stateManager.getState();
        state.settings.use2024Rules = this.#readBool(CONFIG.STORAGE_KEYS.RULES_2024);
        state.settings.showOptional = this.#readBool(CONFIG.STORAGE_KEYS.OPTIONAL);
        state.settings.showHomebrew = this.#readBool(CONFIG.STORAGE_KEYS.HOMEBREW);

        const storedMotion = this.#read(CONFIG.STORAGE_KEYS.REDUCE_MOTION);
        state.settings.reduceMotion = storedMotion !== null ? storedMotion === 'true' : this.#optimizer.shouldReduceMotion();

        state.settings.keepScreenOn = this.#readBool(CONFIG.STORAGE_KEYS.WAKE_LOCK);
        state.settings.theme = this.#readTheme(CONFIG.STORAGE_KEYS.THEME, CONFIG.DEFAULTS.THEME);

        // #19: Auto-detect OS dark mode preference when no stored preference exists
        const storedMode = this.#read(CONFIG.STORAGE_KEYS.MODE);
        state.settings.darkMode = storedMode !== null
            ? storedMode === 'true'
            : window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

        state.settings.density = this.#readDensity(CONFIG.STORAGE_KEYS.DENSITY, 'normal');
    }

    update(key: string, value: boolean | string, broadcast = true): void {
        const cfg = CONFIG.SETTINGS_CONFIG.find((c) => CONFIG.STORAGE_KEYS[c.key as keyof typeof CONFIG.STORAGE_KEYS] === key);
        if (cfg) {
            const state = this.#stateManager.getState();
            if (!this.#isValidValue(cfg.key, cfg.type, value)) return;
            if (state.settings[cfg.stateProp] === value) return;

            state.settings[cfg.stateProp] = value;
            try {
                this.#storage.setItem(key, String(value));
            } catch (e) {
                console.warn(`Failed to persist setting "${key}":`, e);
            }
            this.#stateManager.publish('settingChanged', { key: cfg.key, value });
            if (broadcast) this.#syncService.broadcast('SETTING_CHANGE', { key: cfg.key, value });
        }
    }
}
