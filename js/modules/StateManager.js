import { CONFIG } from './Config.js';

export class StateManager {
  #state;

  #listeners = new Map();

  constructor() {
    this.#state = {
      settings: {},
      user: { favorites: new Set(), notes: new Map() },
      ui: { openPopups: new Map(), activeZIndex: CONFIG.LAYOUT.POPUP_Z_INDEX_BASE, fadeTimeout: null },
      data: {
        rulesets: { 2014: {}, 2024: {} },
        loadedRulesets: { 2014: new Set(), 2024: new Set() },
        ruleMap: new Map(),
        ruleLinkerRegex: null,
      },
    };
  }

  getState = () => this.#state;

  subscribe(event, callback) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(callback);
  }

  publish(event, data) { if (this.#listeners.has(event)) this.#listeners.get(event).forEach((cb) => cb(data)); }
}
