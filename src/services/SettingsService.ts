import { CONFIG } from '../config.js';
import type { StateManager } from '../state/StateManager.js';
import type { SyncService } from './SyncService.js';
import type { PerformanceOptimizer } from './PerformanceOptimizer.js';

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

    #readBool = (key: string): boolean => this.#storage.getItem(key) === 'true';

    #readString = (key: string, def: string): string => this.#storage.getItem(key) || def;

    initialize(): void {
        const state = this.#stateManager.getState();
        state.settings.use2024Rules = this.#readBool(CONFIG.STORAGE_KEYS.RULES_2024);
        state.settings.showOptional = this.#readBool(CONFIG.STORAGE_KEYS.OPTIONAL);
        state.settings.showHomebrew = this.#readBool(CONFIG.STORAGE_KEYS.HOMEBREW);

        const storedMotion = this.#storage.getItem(CONFIG.STORAGE_KEYS.REDUCE_MOTION);
        state.settings.reduceMotion = storedMotion !== null ? storedMotion === 'true' : this.#optimizer.shouldReduceMotion();

        state.settings.keepScreenOn = this.#readBool(CONFIG.STORAGE_KEYS.WAKE_LOCK);
        state.settings.theme = this.#readString(CONFIG.STORAGE_KEYS.THEME, CONFIG.DEFAULTS.THEME);
        state.settings.darkMode = this.#readBool(CONFIG.STORAGE_KEYS.MODE);
        state.settings.density = this.#readString(CONFIG.STORAGE_KEYS.DENSITY, 'normal');
    }

    update(key: string, value: boolean | string, broadcast = true): void {
        const cfg = CONFIG.SETTINGS_CONFIG.find((c) => CONFIG.STORAGE_KEYS[c.key as keyof typeof CONFIG.STORAGE_KEYS] === key);
        if (cfg) {
            const state = this.#stateManager.getState();
            state.settings[cfg.stateProp] = value;
            this.#storage.setItem(key, String(value));
            this.#stateManager.publish('settingChanged', { key: cfg.key, value });
            if (broadcast) this.#syncService.broadcast('SETTING_CHANGE', { key: cfg.key, value });
        }
    }
}
