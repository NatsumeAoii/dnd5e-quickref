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
                width: el.style.width || undefined, height: el.style.height || undefined,
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

            // Validate activeZIndex
            const z = parsed.activeZIndex;
            state.ui.activeZIndex = (typeof z === 'number' && Number.isFinite(z) && z > 0)
                ? z
                : CONFIG.LAYOUT.POPUP_Z_INDEX_BASE;

            // Validate openPopups schema
            if (!Array.isArray(parsed.openPopups)) return [];
            return parsed.openPopups.filter(
                (p: unknown): p is PopupState =>
                    typeof p === 'object' && p !== null && typeof (p as PopupState).id === 'string' && (p as PopupState).id.length > 0,
            );
        } catch (e) {
            console.error('Failed to parse session state:', e);
            return [];
        }
    }
}
