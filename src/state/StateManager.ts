import { CONFIG } from '../config.js';
import type { AppState } from '../types.js';

// #19: Typed event map for compile-time safety on known event names and payloads
export interface StateEventMap {
    settingChanged: { key: string; value: boolean | string };
    favoritesChanged: undefined;
    externalStateChange: { type: string; payload: unknown };
}

export type StateEvent = keyof StateEventMap;
type EventCallback = (data?: unknown) => void;

export class StateManager {
    #state: AppState;
    #listeners = new Map<string, EventCallback[]>();

    constructor() {
        this.#state = {
            settings: {} as AppState['settings'],
            user: { favorites: new Set(), notes: new Map() },
            ui: { openPopups: new Map(), minimizedPopups: new Map(), activeZIndex: CONFIG.LAYOUT.POPUP_Z_INDEX_BASE, fadeTimeout: null },
            data: {
                rulesets: { 2014: {}, 2024: {} },
                loadedRulesets: { 2014: new Set(), 2024: new Set() },
                ruleMap: new Map(),
                ruleLinkerRegex: null,
                titleLookup: new Map(),
                ruleLinkerTrie: null,
            },
        };
    }

    getState = (): AppState => this.#state;

    subscribe<E extends StateEvent>(event: E, callback: (data: StateEventMap[E]) => void): () => void;
    subscribe(event: string, callback: EventCallback): () => void;
    subscribe(event: string, callback: EventCallback): () => void {
        if (!this.#listeners.has(event)) this.#listeners.set(event, []);
        this.#listeners.get(event)!.push(callback);
        return () => this.unsubscribe(event, callback);
    }

    unsubscribe<E extends StateEvent>(event: E, callback: (data: StateEventMap[E]) => void): void;
    unsubscribe(event: string, callback: EventCallback): void;
    unsubscribe(event: string, callback: EventCallback): void {
        const listeners = this.#listeners.get(event);
        if (!listeners) return;
        const idx = listeners.indexOf(callback);
        if (idx !== -1) listeners.splice(idx, 1);
        if (listeners.length === 0) this.#listeners.delete(event);
    }

    // (K) Error isolation — a throwing subscriber must not break sibling listeners
    publish<E extends StateEvent>(event: E, data?: StateEventMap[E]): void;
    publish(event: string, data?: unknown): void;
    publish(event: string, data?: unknown): void {
        const listeners = this.#listeners.get(event);
        if (!listeners) return;
        [...listeners].forEach((cb) => {
            try { cb(data); } catch (e) { console.error(`[StateManager] Listener error for "${event}":`, e); }
        });
    }
}
