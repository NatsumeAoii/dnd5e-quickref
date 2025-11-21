/* eslint-disable no-console */
/* eslint-disable max-len */
/* eslint-disable class-methods-use-this */
import { CONFIG } from './Config.js';
import { DOMElementNotFoundError } from './Utils.js';

export class ServiceWorkerMessenger {
  static #postMessage(message) {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(message);
    }
  }

  static setCachingPolicy(allowed) { this.#postMessage({ type: 'SET_CACHING_POLICY', allowed }); }

  static clearCache() { this.#postMessage({ type: 'CLEAR_CACHE' }); }
}

export class DOMProvider {
  get(id) { const el = document.getElementById(id); if (!el) throw new DOMElementNotFoundError(id); return el; }

  getTemplate(id) { const tpl = this.get(id); if (!(tpl instanceof HTMLTemplateElement)) throw new TypeError(`Element "${id}" is not a <template>.`); return tpl; }

  query = (selector) => document.querySelector(selector);

  queryAll = (selector) => document.querySelectorAll(selector);
}

export class A11yService {
  #announcerEl;

  constructor(domProvider) {
    try { this.#announcerEl = domProvider.get(CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER); } catch { console.warn('ARIA announcer not found.'); }
  }

  announce(message) { if (this.#announcerEl) { this.#announcerEl.textContent = message; } }
}

export class DBService {
  #dbName = 'dnd5e_quickref_db';

  #storeName = 'user_notes';

  #version = 1;

  #db = null;

  async open() {
    if (this.#db) return this.#db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.#dbName, this.#version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.#storeName)) {
          db.createObjectStore(this.#storeName);
        }
      };
      req.onsuccess = (e) => {
        this.#db = e.target.result;
        resolve(this.#db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.#storeName, 'readonly');
      const store = tx.objectStore(this.#storeName);
      const req = store.openCursor();
      const results = {};
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          results[cursor.key] = cursor.value;
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async put(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.#storeName, 'readwrite');
      const store = tx.objectStore(this.#storeName);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

export class WakeLockService {
  #wakeLock = null;

  #isEnabled = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (this.#wakeLock !== null && document.visibilityState === 'visible') {
        this.#requestLock();
      }
    });
  }

  setEnabled(enabled) {
    this.#isEnabled = enabled;
    if (enabled) this.#requestLock();
    else this.#releaseLock();
  }

  async #requestLock() {
    if (!this.#isEnabled || !('wakeLock' in navigator)) return;
    try {
      this.#wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn('Wake Lock failed:', err);
    }
  }

  async #releaseLock() {
    if (this.#wakeLock) {
      await this.#wakeLock.release();
      this.#wakeLock = null;
    }
  }
}

export class SyncService {
  #channel;

  #stateManager;

  constructor(stateManager) {
    this.#stateManager = stateManager;
    this.#channel = new BroadcastChannel('quickref_sync');
    this.#channel.onmessage = (event) => this.#handleMessage(event.data);
  }

  broadcast(type, payload) {
    this.#channel.postMessage({ type, payload });
  }

  #handleMessage({ type, payload }) {
    this.#stateManager.publish('externalStateChange', { type, payload });
  }
}

export class PerformanceOptimizer {
  #isLowEnd = false;

  #isSaveData = false;

  constructor() {
    this.#checkHardware();
    this.#checkNetwork();
  }

  #checkHardware() {
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
      this.#isLowEnd = true;
    }
  }

  #checkNetwork() {
    if (navigator.connection) {
      if (navigator.connection.saveData || navigator.connection.effectiveType === '2g') {
        this.#isSaveData = true;
      }
    }
  }

  shouldReduceMotion() {
    return this.#isLowEnd || this.#isSaveData;
  }
}

export class GamepadService {
  #active = false;

  #domProvider;

  #lastMove = 0;

  #MOVE_DELAY = 150;

  constructor(domProvider) {
    this.#domProvider = domProvider;
    window.addEventListener('gamepadconnected', () => { this.#active = true; this.#poll(); });
    window.addEventListener('gamepaddisconnected', () => { this.#active = false; });
  }

  #poll = () => {
    if (!this.#active) return;
    const gp = navigator.getGamepads()[0];
    if (gp) {
      const now = Date.now();
      if (now - this.#lastMove > this.#MOVE_DELAY) {
        const x = gp.axes[0];
        const y = gp.axes[1];
        if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
          this.#navigate(x, y);
          this.#lastMove = now;
        }
        if (gp.buttons[0].pressed) {
          const focused = document.activeElement;
          if (focused && focused.click) {
            focused.click();
            this.#lastMove = now + 200;
          }
        }
      }
    }
    requestAnimationFrame(this.#poll);
  };

  #navigate(x, y) {
    const items = Array.from(this.#domProvider.queryAll(`.${CONFIG.CSS.ITEM_CLASS}:not([style*="display: none"]) .item-content`));
    if (items.length === 0) return;

    const current = document.activeElement;
    let index = items.indexOf(current);

    if (index === -1) {
      items[0].focus();
      return;
    }

    const containerWidth = this.#domProvider.get(CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA).offsetWidth;
    const itemWidth = items[0].parentElement.offsetWidth;
    const cols = Math.floor(containerWidth / itemWidth);

    if (Math.abs(x) > 0.5) { index += (x > 0 ? 1 : -1); } else if (Math.abs(y) > 0.5) { index += (y > 0 ? cols : -cols); }

    index = Math.max(0, Math.min(index, items.length - 1));
    items[index].focus();
    items[index].scrollIntoView({ block: 'nearest' });
  }
}

export class SettingsService {
  #storage;

  #stateManager;

  #syncService;

  #optimizer;

  constructor(storage, stateManager, syncService, optimizer) {
    this.#storage = storage;
    this.#stateManager = stateManager;
    this.#syncService = syncService;
    this.#optimizer = optimizer;
  }

  #readBool = (key) => this.#storage.getItem(key) === 'true';

  #readString = (key, def) => this.#storage.getItem(key) || def;

  initialize() {
    const state = this.#stateManager.getState();
    state.settings.use2024Rules = this.#readBool(CONFIG.STORAGE_KEYS.RULES_2024);
    state.settings.showOptional = this.#readBool(CONFIG.STORAGE_KEYS.OPTIONAL);
    state.settings.showHomebrew = this.#readBool(CONFIG.STORAGE_KEYS.HOMEBREW);

    // Hardware/Network Aware Default
    const storedMotion = this.#storage.getItem(CONFIG.STORAGE_KEYS.REDUCE_MOTION);
    state.settings.reduceMotion = storedMotion !== null ? storedMotion === 'true' : this.#optimizer.shouldReduceMotion();

    state.settings.keepScreenOn = this.#readBool(CONFIG.STORAGE_KEYS.WAKE_LOCK);
    state.settings.theme = this.#readString(CONFIG.STORAGE_KEYS.THEME, CONFIG.DEFAULTS.THEME);
    state.settings.darkMode = this.#readBool(CONFIG.STORAGE_KEYS.MODE);
  }

  update(key, value, broadcast = true) {
    const cfg = CONFIG.SETTINGS_CONFIG.find((c) => CONFIG.STORAGE_KEYS[c.key] === key);
    if (cfg) {
      const state = this.#stateManager.getState();
      state.settings[cfg.stateProp] = value;
      this.#storage.setItem(key, String(value));
      this.#stateManager.publish('settingChanged', { key: cfg.key, value });
      if (broadcast) this.#syncService.broadcast('SETTING_CHANGE', { key: cfg.key, value });
    }
  }
}

export class UserDataService {
  #storage;

  #stateManager;

  #dbService;

  #syncService;

  constructor(storage, stateManager, dbService, syncService) {
    this.#storage = storage;
    this.#stateManager = stateManager;
    this.#dbService = dbService;
    this.#syncService = syncService;
  }

  #load = (key, def) => {
    try { const val = this.#storage.getItem(key); return val ? JSON.parse(val) : def; } catch (e) { console.error(`Failed to parse user data for "${key}":`, e); return def; }
  };

  async initialize() {
    const state = this.#stateManager.getState();
    state.user.favorites = new Set(this.#load(CONFIG.STORAGE_KEYS.FAVORITES, []));

    try {
      const notes = await this.#dbService.getAll();
      state.user.notes = new Map(Object.entries(notes));

      const legacyNotes = this.#load(CONFIG.STORAGE_KEYS.NOTES, null);
      if (legacyNotes) {
        for (const [k, v] of Object.entries(legacyNotes)) {
          if (!state.user.notes.has(k)) {
            state.user.notes.set(k, v);
            await this.#dbService.put(k, v);
          }
        }
        this.#storage.removeItem(CONFIG.STORAGE_KEYS.NOTES);
      }
    } catch (e) {
      console.error('DB Init failed', e);
    }
  }

  toggleFavorite(id, broadcast = true) {
    const state = this.#stateManager.getState();
    if (state.user.favorites.has(id)) {
      state.user.favorites.delete(id);
    } else {
      state.user.favorites.add(id);
    }
    this.#storage.setItem(CONFIG.STORAGE_KEYS.FAVORITES, JSON.stringify([...state.user.favorites]));
    this.#stateManager.publish('favoritesChanged');
    if (broadcast) this.#syncService.broadcast('FAVORITE_TOGGLE', { id });
  }

  updateFavoritesOrder(newOrderArray) {
    const state = this.#stateManager.getState();
    state.user.favorites = new Set(newOrderArray);
    this.#storage.setItem(CONFIG.STORAGE_KEYS.FAVORITES, JSON.stringify(newOrderArray));
  }

  isFavorite = (id) => this.#stateManager.getState().user.favorites.has(id);

  saveNote(id, text, broadcast = true) {
    const state = this.#stateManager.getState();
    state.user.notes.set(id, text);
    this.#dbService.put(id, text).catch((e) => console.error('Save note failed', e));
    if (broadcast) this.#syncService.broadcast('NOTE_UPDATE', { id, text });
  }

  getNote = (id) => this.#stateManager.getState().user.notes.get(id) || '';

  async exportNotes() {
    const notes = Object.fromEntries(this.#stateManager.getState().user.notes);
    const jsonString = JSON.stringify(notes);

    const stream = new Blob([jsonString]).stream();
    const compressedReadableStream = stream.pipeThrough(new CompressionStream('gzip'));
    const compressedResponse = await new Response(compressedReadableStream);
    const blob = await compressedResponse.blob();

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quickref-notes-${new Date().toISOString().split('T')[0]}.json.gz`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export class PersistenceService {
  #storage;

  #stateManager;

  constructor(storage, stateManager) { this.#storage = storage; this.#stateManager = stateManager; }

  saveSession() {
    const state = this.#stateManager.getState();
    const sessionState = { openPopups: [], activeZIndex: state.ui.activeZIndex };
    state.ui.openPopups.forEach((el, id) => {
      sessionState.openPopups.push({
        id, top: el.style.top, left: el.style.left, zIndex: el.style.zIndex,
      });
    });
    this.#storage.setItem(CONFIG.SESSION_STORAGE_KEYS.UI_SESSION, JSON.stringify(sessionState));
  }

  loadSession() {
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
