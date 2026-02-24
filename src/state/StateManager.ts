import { CONFIG } from '../config.js';
import type { AppState } from '../types.js';

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
            },
        };
    }

    getState = (): AppState => this.#state;

    subscribe(event: string, callback: EventCallback): void {
        if (!this.#listeners.has(event)) this.#listeners.set(event, []);
        this.#listeners.get(event)!.push(callback);
    }

    // (K) Error isolation — a throwing subscriber must not break sibling listeners
    publish(event: string, data?: unknown): void {
        if (this.#listeners.has(event)) {
            this.#listeners.get(event)!.forEach((cb) => {
                try { cb(data); } catch (e) { console.error(`[StateManager] Listener error for "${event}":`, e); }
            });
        }
    }
}
