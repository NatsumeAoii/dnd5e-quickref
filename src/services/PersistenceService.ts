import { CONFIG } from '../config.js';
import type { StateManager } from '../state/StateManager.js';
import type { PopupState } from '../types.js';

export class PersistenceService {
    #storage: Storage;
    #stateManager: StateManager;

    constructor(storage: Storage, stateManager: StateManager) { this.#storage = storage; this.#stateManager = stateManager; }

    #safeCssLength(value: unknown, maxPx = 10_000): string | undefined {
        if (typeof value !== 'string' || value.length > 32) return undefined;
        const match = value.match(/^(-?\d+(?:\.\d+)?)(px|rem|em|vh|vw|%)$/);
        if (!match) return undefined;
        const amount = Number(match[1]);
        if (!Number.isFinite(amount)) return undefined;
        if (match[2] === 'px' && Math.abs(amount) > maxPx) return undefined;
        return value;
    }

    #safeZIndex(value: unknown): string | undefined {
        if (typeof value !== 'string' && typeof value !== 'number') return undefined;
        const z = Number(value);
        if (!Number.isInteger(z) || z < 0 || z > 2_147_483_647) return undefined;
        return String(z);
    }

    #sanitizePopupState(value: unknown): PopupState | null {
        if (!value || typeof value !== 'object') return null;
        const raw = value as Record<string, unknown>;
        if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 200) return null;
        const popup: PopupState = { id: raw.id };
        const top = this.#safeCssLength(raw.top);
        const left = this.#safeCssLength(raw.left);
        const zIndex = this.#safeZIndex(raw.zIndex);
        const width = this.#safeCssLength(raw.width, 5_000);
        const height = this.#safeCssLength(raw.height, 5_000);
        if (top) popup.top = top;
        if (left) popup.left = left;
        if (zIndex) popup.zIndex = zIndex;
        if (width) popup.width = width;
        if (height) popup.height = height;
        return popup;
    }

    saveSession(): void {
        const state = this.#stateManager.getState();
        const sessionState = { openPopups: [] as PopupState[], activeZIndex: state.ui.activeZIndex };
        state.ui.openPopups.forEach((el, id) => {
            sessionState.openPopups.push({
                id, top: el.style.top, left: el.style.left, zIndex: el.style.zIndex,
                width: el.style.width || undefined, height: el.style.height || undefined,
            });
        });
        try {
            this.#storage.setItem(CONFIG.SESSION_STORAGE_KEYS.UI_SESSION, JSON.stringify(sessionState));
        } catch (e) {
            console.warn('Failed to save session state:', e);
        }
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

            if (!Array.isArray(parsed.openPopups)) return [];
            return parsed.openPopups
                .map((p: unknown) => this.#sanitizePopupState(p))
                .filter((p: PopupState | null): p is PopupState => p !== null);
        } catch (e) {
            console.error('Failed to parse session state:', e);
            return [];
        }
    }
}
