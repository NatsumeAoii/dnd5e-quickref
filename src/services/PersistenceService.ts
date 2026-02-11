import { CONFIG } from '../config.js';
import type { StateManager } from '../state/StateManager.js';
import type { PopupState } from '../types.js';

export class PersistenceService {
    #storage: Storage;
    #stateManager: StateManager;

    constructor(storage: Storage, stateManager: StateManager) { this.#storage = storage; this.#stateManager = stateManager; }

    saveSession(): void {
        const state = this.#stateManager.getState();
        const sessionState = { openPopups: [] as PopupState[], activeZIndex: state.ui.activeZIndex };
        state.ui.openPopups.forEach((el, id) => {
            sessionState.openPopups.push({
                id, top: el.style.top, left: el.style.left, zIndex: el.style.zIndex,
            });
        });
        this.#storage.setItem(CONFIG.SESSION_STORAGE_KEYS.UI_SESSION, JSON.stringify(sessionState));
    }

    loadSession(): PopupState[] {
        const saved = this.#storage.getItem(CONFIG.SESSION_STORAGE_KEYS.UI_SESSION);
        if (!saved) return [];
        try {
            const parsed = JSON.parse(saved);
            const state = this.#stateManager.getState();
            state.ui.activeZIndex = parsed.activeZIndex || state.ui.activeZIndex;
            return parsed.openPopups || [];
        } catch (e) {
            console.error('Failed to parse session state:', e);
            return [];
        }
    }
}
