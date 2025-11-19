/* eslint-disable no-undef */
/* eslint-disable no-new */
/* eslint-disable no-await-in-loop */
/* eslint-disable consistent-return */
/* eslint-disable no-cond-assign */
/* eslint-disable no-unused-vars */
/* eslint-disable max-len */
/* eslint-disable no-console */
(function (window, document) {
  // --- Trusted Types Policy ---
  let trustedPolicy;
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    try {
      trustedPolicy = window.trustedTypes.createPolicy('default', {
        createHTML: (string) => string,
        createScriptURL: (string) => string,
        createScript: (string) => string,
      });
    } catch (e) { console.warn('Trusted Types policy creation failed:', e); }
  }
  const safeHTML = (html) => (trustedPolicy ? trustedPolicy.createHTML(html) : html);
  const safeScriptURL = (url) => (trustedPolicy ? trustedPolicy.createScriptURL(url) : url);

  const CONFIG = Object.freeze({
    STORAGE_KEYS: Object.freeze({
      RULES_2024: 'rules2024',
      OPTIONAL: 'optional',
      HOMEBREW: 'homebrew',
      THEME: 'theme',
      MODE: 'mode',
      REDUCE_MOTION: 'reduceMotion',
      WAKE_LOCK: 'wakeLock',
      COOKIES_ACCEPTED: 'cookiesAccepted',
      FAVORITES: 'userFavorites',
      NOTES: 'userNotes',
    }),
    SESSION_STORAGE_KEYS: Object.freeze({
      RULESET_CHANGED: 'rulesetChanged',
      UI_SESSION: 'uiSession',
      COOKIES_REMINDER_DISMISSED: 'cookiesReminderDismissed',
    }),
    ELEMENT_IDS: Object.freeze({
      POPUP_CONTAINER: 'popup-container',
      COOKIE_NOTICE: 'cookie-notice',
      ACCEPT_COOKIES_BTN: 'accept-cookies',
      REMIND_COOKIES_LATER_BTN: 'remind-cookies-later',
      COPYRIGHT_YEAR: 'copyright-year',
      CLOSE_ALL_POPUPS_BTN: 'close-all-popups-btn',
      FAVORITES_CONTAINER: 'favorites-container',
      FAVORITES_PLACEHOLDER: 'favorites-placeholder',
      SECTION_FAVORITES: 'section-favorites',
      ARIA_ANNOUNCER: 'aria-announcer',
      MAIN_SCROLL_AREA: 'main-scroll-area',
      RULE_ITEM_TEMPLATE: 'rule-item-template',
      POPUP_TEMPLATE: 'popup-template',
      THEME_SELECT: 'theme-select',
      THEME_STYLESHEET: 'theme-stylesheet',
      SKELETON_LOADER: 'skeleton-loader',
      APP_CONTAINER: 'app-container',
      NOTIFICATION_CONTAINER: 'notification-container',
      REPORT_RULE_BTN: 'report-rule-btn',
      EXPORT_NOTES_BTN: 'export-notes-btn',
    }),
    THEME_CONFIG: Object.freeze({
      PATH: 'themes/',
      MANIFEST: 'themes/themes.json',
    }),
    DATA_FILES: Object.freeze(['movement', 'action', 'bonusaction', 'reaction', 'condition', 'environment']),
    SECTION_CONFIG: Object.freeze([
      { id: 'basic-movement', dataKey: 'movement', type: 'Move' },
      { id: 'basic-actions', dataKey: 'action', type: 'Action' },
      { id: 'basic-bonus-actions', dataKey: 'bonusaction', type: 'Bonus action' },
      { id: 'basic-reactions', dataKey: 'reaction', type: 'Reaction' },
      { id: 'basic-conditions', dataKey: 'condition', type: 'Condition' },
      { id: 'environment-obscurance', dataKey: 'environment_obscurance', type: 'Environment' },
      { id: 'environment-light', dataKey: 'environment_light', type: 'Environment' },
      { id: 'environment-vision', dataKey: 'environment_vision', type: 'Environment' },
      { id: 'environment-cover', dataKey: 'environment_cover', type: 'Environment' },
      { id: 'environment-other', dataKey: 'environment_other', type: 'Environment' },
    ]),
    SETTINGS_CONFIG: Object.freeze([
      {
        id: 'optional-switch', key: 'OPTIONAL', stateProp: 'showOptional', type: 'checkbox',
      },
      {
        id: 'homebrew-switch', key: 'HOMEBREW', stateProp: 'showHomebrew', type: 'checkbox',
      },
      {
        id: 'rules2024-switch', key: 'RULES_2024', stateProp: 'use2024Rules', type: 'checkbox',
      },
      {
        id: 'reduce-motion-switch', key: 'REDUCE_MOTION', stateProp: 'reduceMotion', type: 'checkbox',
      },
      {
        id: 'wakelock-switch', key: 'WAKE_LOCK', stateProp: 'keepScreenOn', type: 'checkbox',
      },
      {
        id: 'theme-select', key: 'THEME', stateProp: 'theme', type: 'select',
      },
      {
        id: 'mode-switch', key: 'MODE', stateProp: 'darkMode', type: 'checkbox',
      },
    ]),
    CSS: Object.freeze({
      FATAL_ERROR: 'fatal-error-message',
      MOTION_REDUCED: 'motion-reduced',
      ITEM_CLASS: 'item',
      ITEM_SIZE_CLASS: 'itemsize',
      IS_DRAGGING: 'is-dragging',
      IS_ACTIVE: 'is-active',
      IS_CLOSING: 'is-closing',
      IS_VISIBLE: 'is-visible',
      IS_FAVORITED: 'is-favorited',
      IS_COLLAPSED: 'is-collapsed',
      LINK_DISABLED: 'is-disabled',
      POPUP_WINDOW: 'popup-window',
      POPUP_MODAL: 'is-modal',
      POPUP_CONTAINER_MODAL_OPEN: 'modal-open',
      POPUP_CLOSE_BTN: 'popup-close-btn',
      SECTION_CONTAINER: 'section-container',
      HIDDEN: 'hidden',
      SECTION_TITLE: 'section-title',
      SECTION_CONTENT: 'section-content',
      IS_FOCUSED: 'is-focused',
      DRAG_OVER: 'drag-over',
    }),
    DEFAULTS: Object.freeze({
      ICON: '', TITLE: '[Untitled Rule]', RULE_TYPE: 'Standard rule', THEME: 'original',
    }),
    ATTRIBUTES: Object.freeze({
      RULE_TYPE: 'data-rule-type',
      FILTERABLE: 'data-filterable',
      POPUP_ID: 'data-popup-id',
      RENDERED: 'data-rendered',
      SECTION_KEY: 'data-section',
      ICON: 'data-icon',
    }),
    UI_STRINGS: Object.freeze({
      NOTE_STATUS_SAVING: 'Saving...',
      NOTE_STATUS_SAVED: '✓ Saved',
      RULE_NOT_FOUND: 'The requested rule could not be found.',
    }),
    DEBOUNCE_DELAY: { RESIZE_MS: 200, NOTE_AUTOSAVE_MS: 750 },
    ANIMATION_DURATION: {
      ITEM_DELAY_MS: 30, POPUP_MS: 300, NOTE_FADEOUT_MS: 2000, NOTIFICATION_MS: 4000,
    },
    LAYOUT: {
      DESKTOP_BREAKPOINT_MIN_PX: 1024,
      POPUP_CASCADE_OFFSET_PX: 30,
      POPUP_CASCADE_WRAP_COUNT: 10,
      POPUP_Z_INDEX_BASE: 1000,
      POPUP_VIEWPORT_PADDING_PX: 8,
    },
  });

  class DOMElementNotFoundError extends Error {
    constructor(elementId) { super(`Required DOM element with ID "${elementId}" was not found.`); this.name = 'DOMElementNotFoundError'; }
  }
  class DataLoadError extends Error {
    constructor(src, details = '') { super(`Failed to load required data: ${src}. ${details}`); this.name = 'DataLoadError'; }
  }

  const debounce = (func, delay) => {
    let timeoutId;
    return function (...args) {
      const ctx = this;
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(ctx, args), delay);
    };
  };

  class ServiceWorkerMessenger {
    static #postMessage(message) {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage(message);
      }
    }

    static setCachingPolicy(allowed) { this.#postMessage({ type: 'SET_CACHING_POLICY', allowed }); }

    static clearCache() { this.#postMessage({ type: 'CLEAR_CACHE' }); }
  }

  class DOMProvider {
    get(id) { const el = document.getElementById(id); if (!el) throw new DOMElementNotFoundError(id); return el; }

    getTemplate(id) { const tpl = this.get(id); if (!(tpl instanceof HTMLTemplateElement)) throw new TypeError(`Element "${id}" is not a <template>.`); return tpl; }

    query = (selector) => document.querySelector(selector);

    queryAll = (selector) => document.querySelectorAll(selector);
  }

  class StateManager {
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

    subscribe(event, callback) { if (!this.#listeners.has(event)) this.#listeners.set(event, []); this.#listeners.get(event).push(callback); }

    publish(event, data) { if (this.#listeners.has(event)) this.#listeners.get(event).forEach((cb) => cb(data)); }
  }

  class A11yService {
    #announcerEl;

    constructor(domProvider) {
      try { this.#announcerEl = domProvider.get(CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER); } catch { console.warn('ARIA announcer not found.'); }
    }

    announce(message) { if (this.#announcerEl) { this.#announcerEl.textContent = message; } }
  }

  class DBService {
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

  class WakeLockService {
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

  class SyncService {
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

  class PerformanceOptimizer {
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

  class DragDropManager {
    #container;

    #userDataService;

    #draggedItem = null;

    constructor(containerId, userDataService) {
      this.#container = document.getElementById(containerId);
      this.#userDataService = userDataService;
      if (this.#container) this.#init();
    }

    #init() {
      this.#container.addEventListener('dragstart', this.#handleDragStart);
      this.#container.addEventListener('dragover', this.#handleDragOver);
      this.#container.addEventListener('drop', this.#handleDrop);
      this.#container.addEventListener('dragend', this.#handleDragEnd);
    }

    #handleDragStart = (e) => {
      const item = e.target.closest(`.${CONFIG.CSS.ITEM_CLASS}`);
      if (!item) return;
      this.#draggedItem = item;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID));
      setTimeout(() => item.classList.add(CONFIG.CSS.IS_DRAGGING), 0);
    };

    #handleDragOver = (e) => {
      e.preventDefault();
      const target = e.target.closest(`.${CONFIG.CSS.ITEM_CLASS}`);
      if (target && target !== this.#draggedItem) {
        target.classList.add(CONFIG.CSS.DRAG_OVER);
      }
    };

    #handleDrop = (e) => {
      e.preventDefault();
      const target = e.target.closest(`.${CONFIG.CSS.ITEM_CLASS}`);
      if (target && this.#draggedItem && target !== this.#draggedItem) {
        // Reorder DOM
        const items = [...this.#container.children];
        const fromIndex = items.indexOf(this.#draggedItem);
        const toIndex = items.indexOf(target);

        if (fromIndex < toIndex) {
          target.after(this.#draggedItem);
        } else {
          target.before(this.#draggedItem);
        }

        // Reorder Data
        const newOrder = [...this.#container.children].map((el) => el.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID));
        this.#userDataService.updateFavoritesOrder(newOrder);
      }
      this.#cleanup();
    };

    #handleDragEnd = () => this.#cleanup();

    #cleanup() {
      if (this.#draggedItem) this.#draggedItem.classList.remove(CONFIG.CSS.IS_DRAGGING);
      this.#container.querySelectorAll(`.${CONFIG.CSS.DRAG_OVER}`).forEach((el) => el.classList.remove(CONFIG.CSS.DRAG_OVER));
      this.#draggedItem = null;
    }
  }

  class GamepadService {
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

  class SettingsService {
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

  class UserDataService {
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
      state.user.favorites.has(id) ? state.user.favorites.delete(id) : state.user.favorites.add(id);
      this.#storage.setItem(CONFIG.STORAGE_KEYS.FAVORITES, JSON.stringify([...state.user.favorites]));
      this.#stateManager.publish('favoritesChanged');
      if (broadcast) this.#syncService.broadcast('FAVORITE_TOGGLE', { id });
    }

    updateFavoritesOrder(newOrderArray) {
      const state = this.#stateManager.getState();
      state.user.favorites = new Set(newOrderArray);
      this.#storage.setItem(CONFIG.STORAGE_KEYS.FAVORITES, JSON.stringify(newOrderArray));
      // No broadcast needed for drag-drop usually, or could add if desired
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

  class PersistenceService {
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

  class DataService {
    #stateManager;

    #fetchPromises = new Map();

    constructor(stateManager) { this.#stateManager = stateManager; }

    #getRulesetKey = (is2024) => (is2024 ? '2024' : '2014');

    getDataSourceKey = (key) => (key.startsWith('environment_') ? 'environment' : key);

    async #loadDataFile(dataFileName, rulesetKey) {
      const state = this.#stateManager.getState();
      if (state.data.loadedRulesets[rulesetKey].has(dataFileName)) return;

      const cacheKey = `${rulesetKey}_${dataFileName}`;
      if (this.#fetchPromises.has(cacheKey)) return this.#fetchPromises.get(cacheKey);

      const prefix = rulesetKey === '2024' ? '2024_' : '';
      const path = `js/${prefix}data_${dataFileName}.json`;

      const promise = (async () => {
        try {
          const res = await fetch(path);
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
      await Promise.all(CONFIG.DATA_FILES.map((file) => this.#loadDataFile(file, rulesetKey)));
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

  class TemplateService {
    #domProvider;

    constructor(domProvider) { this.#domProvider = domProvider; }

    #renderers = {
      paragraph: (bullet, linkifyFn) => {
        const p = document.createElement('p');
        p.innerHTML = safeHTML(linkifyFn(bullet.content || ''));
        return p;
      },
      list: (bullet, linkifyFn) => {
        const ul = document.createElement('ul');
        (bullet.items || []).forEach((itemText) => {
          const li = document.createElement('li');
          li.innerHTML = safeHTML(linkifyFn(itemText));
          ul.appendChild(li);
        });
        return ul;
      },
      table: (bullet, linkifyFn) => {
        const table = document.createElement('table');
        table.className = 'rule-table';
        if (bullet.headers?.length) {
          const thead = table.createTHead();
          const headerRow = thead.insertRow();
          bullet.headers.forEach((headerText) => {
            const th = document.createElement('th');
            th.textContent = headerText;
            headerRow.appendChild(th);
          });
        }
        if (bullet.rows?.length) {
          const tbody = table.createTBody();
          bullet.rows.forEach((rowData) => {
            const row = tbody.insertRow();
            rowData.forEach((cellData) => {
              const cell = row.insertCell();
              cell.innerHTML = safeHTML(linkifyFn(String(cellData ?? '')));
            });
          });
        }
        return table;
      },
    };

    #renderBullets(bullets, linkifyFn) {
      const fragment = document.createDocumentFragment();
      if (!Array.isArray(bullets)) return fragment;
      bullets.forEach((bullet) => {
        const renderer = this.#renderers[bullet.type];
        if (renderer) fragment.appendChild(renderer(bullet, linkifyFn));
        else {
          console.warn(`Unknown bullet type: "${bullet.type}"`);
          const p = document.createElement('p');
          p.textContent = JSON.stringify(bullet);
          fragment.appendChild(p);
        }
      });
      return fragment;
    }

    createRuleItemElement(popupId, ruleData, isFavorite) {
      const tpl = this.#domProvider.getTemplate(CONFIG.ELEMENT_IDS.RULE_ITEM_TEMPLATE);
      const item = tpl.content.cloneNode(true).firstElementChild;
      const ruleType = ruleData.optional || CONFIG.DEFAULTS.RULE_TYPE;
      const title = ruleData.title || CONFIG.DEFAULTS.TITLE;

      item.setAttribute(CONFIG.ATTRIBUTES.RULE_TYPE, ruleType);
      item.setAttribute(CONFIG.ATTRIBUTES.POPUP_ID, popupId);
      item.setAttribute('draggable', 'true'); // Enable Drag

      const iconEl = item.querySelector('.item-icon');
      iconEl.className = 'item-icon iconsize';
      iconEl.setAttribute(CONFIG.ATTRIBUTES.ICON, ruleData.icon || CONFIG.DEFAULTS.ICON);

      item.querySelector('.item-title').textContent = title;
      item.querySelector('.item-desc').textContent = ruleData.subtitle || '';
      item.querySelector('.favorite-btn').classList.toggle(CONFIG.CSS.IS_FAVORITED, isFavorite);
      return item;
    }

    createPopupElement(popupId, { ruleData, type, sectionId }, linkifyFn, getNoteFn) {
      const tpl = this.#domProvider.getTemplate(CONFIG.ELEMENT_IDS.POPUP_TEMPLATE);
      const popup = tpl.content.cloneNode(true).firstElementChild;
      const sourceSection = document.getElementById(sectionId)?.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`);
      const borderColor = sourceSection ? window.getComputedStyle(sourceSection).borderColor : 'var(--color-hr)';

      popup.setAttribute('aria-labelledby', `popup-title-${popupId}`);
      popup.style.setProperty('--section-color', borderColor);

      const titleEl = popup.querySelector('.popup-title');
      titleEl.id = `popup-title-${popupId}`;
      titleEl.textContent = ruleData.title || CONFIG.DEFAULTS.TITLE;

      popup.querySelector('.popup-header').style.backgroundColor = borderColor;
      popup.querySelector('.popup-type').textContent = type;
      popup.querySelector('.popup-description').innerHTML = safeHTML(linkifyFn(ruleData.description || ruleData.subtitle || ''));
      popup.querySelector('.popup-summary').innerHTML = safeHTML(linkifyFn(ruleData.summary || ''));
      popup.querySelector('.popup-bullets').replaceChildren(this.#renderBullets(ruleData.bullets, linkifyFn));

      const refContainer = popup.querySelector('.popup-reference-container');
      const referenceEl = refContainer.querySelector('.popup-reference');
      const toggleBtn = refContainer.querySelector('.popup-toggle-details-btn');

      if (ruleData.reference) {
        referenceEl.textContent = ruleData.reference;
        referenceEl.classList.remove(CONFIG.CSS.HIDDEN);
      } else {
        referenceEl.classList.add(CONFIG.CSS.HIDDEN);
      }

      if (!ruleData.bullets?.length) {
        toggleBtn.classList.add(CONFIG.CSS.HIDDEN);
        if (!ruleData.summary) popup.querySelector('.popup-summary').classList.add(CONFIG.CSS.HIDDEN);
      }

      const textarea = popup.querySelector('.popup-notes-textarea');
      const notesLabel = popup.querySelector('.popup-notes-label');
      notesLabel.setAttribute('for', `notes-${popupId}`);
      textarea.id = `notes-${popupId}`;
      textarea.value = getNoteFn(popupId);
      return popup;
    }
  }

  class ViewRenderer {
    #domProvider;

    #stateManager;

    #userDataService;

    #templateService;

    #notificationContainer;

    constructor(domProvider, stateManager, userDataService, templateService) {
      this.#domProvider = domProvider;
      this.#stateManager = stateManager;
      this.#userDataService = userDataService;
      this.#templateService = templateService;
      try { this.#notificationContainer = this.#domProvider.get(CONFIG.ELEMENT_IDS.NOTIFICATION_CONTAINER); } catch (e) { console.error('Notification container not found.'); }
    }

    renderSection(parentId, rules) {
      const parent = this.#domProvider.get(parentId);
      const fragment = document.createDocumentFragment();
      rules.forEach(({ popupId, ruleInfo }, index) => {
        const item = this.#templateService.createRuleItemElement(popupId, ruleInfo.ruleData, this.#userDataService.isFavorite(popupId));
        item.style.animationDelay = `${index * CONFIG.ANIMATION_DURATION.ITEM_DELAY_MS}ms`;
        fragment.appendChild(item);
      });

      if (document.startViewTransition) {
        document.startViewTransition(() => {
          parent.replaceChildren(fragment);
          this.#postRender(parent);
        });
      } else {
        parent.replaceChildren(fragment);
        this.#postRender(parent);
      }
    }

    #postRender(parent) {
      parent.querySelectorAll(`[${CONFIG.ATTRIBUTES.ICON}]`).forEach((iconEl) => {
        const iconName = iconEl.getAttribute(CONFIG.ATTRIBUTES.ICON);
        if (iconName) iconEl.classList.add(`icon-${iconName}`);
      });
      this.filterRuleItems();
    }

    renderFavoritesSection() {
      const state = this.#stateManager.getState();
      const favs = [...state.user.favorites]
        .map((id) => ({ popupId: id, ruleInfo: state.data.ruleMap.get(id) }))
        .filter((item) => item.ruleInfo);
      this.renderSection(CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER, favs);
      this.#domProvider.get(CONFIG.ELEMENT_IDS.FAVORITES_PLACEHOLDER).style.display = favs.length > 0 ? 'none' : 'block';
      this.#domProvider.get(CONFIG.ELEMENT_IDS.SECTION_FAVORITES).classList.toggle(CONFIG.CSS.HIDDEN, favs.length === 0);
    }

    applyAppearance({ theme, darkMode }) {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = darkMode ? 'dark' : 'light';
      try {
        const themeLink = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_STYLESHEET);
        if (theme !== 'original') {
          themeLink.href = `${CONFIG.THEME_CONFIG.PATH}${theme}.css`;
          themeLink.disabled = false;
        } else {
          themeLink.href = '';
          themeLink.disabled = true;
        }
      } catch (e) { console.error('Failed to apply theme stylesheet:', e); }
    }

    applyMotionReduction = (isEnabled) => document.body.classList.toggle(CONFIG.CSS.MOTION_REDUCED, isEnabled);

    filterRuleItems() {
      const { showOptional, showHomebrew } = this.#stateManager.getState().settings;
      this.#domProvider.queryAll(`.${CONFIG.CSS.ITEM_SIZE_CLASS}`).forEach((item) => {
        if (item.getAttribute(CONFIG.ATTRIBUTES.FILTERABLE) === 'false') return;
        const type = item.getAttribute(CONFIG.ATTRIBUTES.RULE_TYPE);
        const isOpt = type === 'Optional rule';
        const isHB = type === 'Homebrew rule';
        const show = (!isOpt && !isHB) || (isOpt && showOptional) || (isHB && showHomebrew);
        if (item instanceof HTMLElement) item.style.display = show ? 'flex' : 'none';
      });
    }

    renderFatalError(msg) {
      const err = document.createElement('p');
      err.textContent = msg;
      err.className = CONFIG.CSS.FATAL_ERROR;
      document.body.replaceChildren(err);
    }

    updateCopyrightYear() {
      try { this.#domProvider.get(CONFIG.ELEMENT_IDS.COPYRIGHT_YEAR).textContent = new Date().getFullYear().toString(); } catch (e) { console.warn(`Could not update copyright year: ${e.message}`); }
    }

    showApp() {
      this.#domProvider.get(CONFIG.ELEMENT_IDS.SKELETON_LOADER).classList.add(CONFIG.CSS.HIDDEN);
      const app = this.#domProvider.get(CONFIG.ELEMENT_IDS.APP_CONTAINER);
      app.classList.remove(CONFIG.CSS.HIDDEN);
      app.style.opacity = '1';
    }

    showNotification(message, level = 'info') {
      if (!this.#notificationContainer) return;
      const notification = document.createElement('div');
      notification.className = 'notification';
      notification.dataset.level = level;
      notification.textContent = message;
      notification.setAttribute('role', 'alert');
      this.#notificationContainer.appendChild(notification);
      setTimeout(() => notification.remove(), CONFIG.ANIMATION_DURATION.NOTIFICATION_MS);
    }
  }

  class PopupFactory {
    #templateService;

    #userDataService;

    #stateManager;

    constructor(templateService, userDataService, stateManager) {
      this.#templateService = templateService;
      this.#userDataService = userDataService;
      this.#stateManager = stateManager;
    }

    create(id, ruleInfo, linkifyFn) {
      const popup = this.#templateService.createPopupElement(id, ruleInfo, linkifyFn, this.#userDataService.getNote);
      this.#attachNoteHandlers(popup, id);
      return popup;
    }

    #attachNoteHandlers(popup, id) {
      const textarea = popup.querySelector('.popup-notes-textarea');
      const statusEl = popup.querySelector('.popup-notes-status');
      if (!textarea || !statusEl) return;

      const debouncedSave = debounce(() => {
        this.#userDataService.saveNote(id, textarea.value);
        statusEl.textContent = CONFIG.UI_STRINGS.NOTE_STATUS_SAVED;
        const state = this.#stateManager.getState();
        state.ui.fadeTimeout = setTimeout(() => {
          if (statusEl.textContent === CONFIG.UI_STRINGS.NOTE_STATUS_SAVED) statusEl.textContent = '';
        }, CONFIG.ANIMATION_DURATION.NOTE_FADEOUT_MS);
      }, CONFIG.DEBOUNCE_DELAY.NOTE_AUTOSAVE_MS);

      textarea.addEventListener('input', () => {
        clearTimeout(this.#stateManager.getState().ui.fadeTimeout);
        statusEl.textContent = CONFIG.UI_STRINGS.NOTE_STATUS_SAVING;
        debouncedSave();
      });
    }
  }

  class WindowManager {
    #domProvider;

    #stateManager;

    #persistenceService;

    #a11yService;

    #popupFactory;

    #viewRenderer;

    #dataService;

    #popupContainer;

    #closeAllBtn;

    #isMobileView = false;

    #TYPE_ENCODING = Object.freeze({
      Action: 'Ac', 'Bonus action': 'Ba', Condition: 'Co', Environment: 'En', Move: 'Mo', Reaction: 'Re',
    });

    #TYPE_DECODING = Object.freeze(Object.fromEntries(Object.entries(this.#TYPE_ENCODING).map(([k, v]) => [v, k])));

    constructor(services) {
      this.#domProvider = services.domProvider;
      this.#stateManager = services.stateManager;
      this.#persistenceService = services.persistence;
      this.#a11yService = services.a11y;
      this.#popupFactory = services.popupFactory;
      this.#viewRenderer = services.viewRenderer;
      this.#dataService = services.data;
    }

    initialize() {
      this.#popupContainer = this.#domProvider.get(CONFIG.ELEMENT_IDS.POPUP_CONTAINER);
      this.#closeAllBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN);
      this.#handleResize();
      this.#popupContainer.addEventListener('click', this.#handleContainerClick);
      this.#closeAllBtn.addEventListener('click', this.closeAllPopups);
      window.addEventListener('resize', debounce(this.#handleResize, CONFIG.DEBOUNCE_DELAY.RESIZE_MS));
      document.addEventListener('keydown', this.#handleKeyDown);
      window.addEventListener('hashchange', this.#handleHashChange);
    }

    #toShortId = (fullId) => {
      if (!fullId?.includes('::')) return fullId;
      const [type, title] = fullId.split('::');
      const encodedType = this.#TYPE_ENCODING[type];
      return encodedType ? `${encodedType}-${encodeURIComponent(title)}` : fullId;
    };

    #fromShortId = (shortId) => {
      if (!shortId?.includes('-')) return shortId;
      const separatorIndex = shortId.indexOf('-');
      const encodedType = shortId.substring(0, separatorIndex);
      const encodedTitle = shortId.substring(separatorIndex + 1);
      const type = this.#TYPE_DECODING[encodedType];
      return type ? `${type}::${decodeURIComponent(encodedTitle)}` : shortId;
    };

    #linkifyContent = (html) => {
      const state = this.#stateManager.getState();
      if (!html || !state.data.ruleLinkerRegex) return html;

      const container = document.createElement('div');
      container.innerHTML = safeHTML(html);

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
      const textNodes = [];
      let node;
      while ((node = walker.nextNode())) {
        textNodes.push(node);
      }

      textNodes.forEach((textNode) => {
        const text = textNode.nodeValue;
        const matches = Array.from(text.matchAll(state.data.ruleLinkerRegex));
        if (matches.length === 0) return;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        matches.forEach((match) => {
          const matchText = match[0];
          const matchIndex = match.index;

          if (matchIndex > lastIndex) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchIndex)));
          }

          const link = document.createElement('a');
          link.className = 'rule-link';
          link.textContent = matchText;
          const id = Array.from(state.data.ruleMap.keys())
            .find((key) => key.toLowerCase().endsWith(`::${matchText.toLowerCase()}`));

          if (id) {
            link.setAttribute(CONFIG.ATTRIBUTES.POPUP_ID, id);
            const preload = () => {
              const ruleInfo = state.data.ruleMap.get(id);
              if (ruleInfo) {
                const sectionConfig = CONFIG.SECTION_CONFIG.find((c) => c.id === ruleInfo.sectionId);
                if (sectionConfig) this.#dataService.ensureSectionDataLoaded(this.#dataService.getDataSourceKey(sectionConfig.dataKey));
              }
            };
            link.addEventListener('mouseenter', preload, { once: true });
            link.addEventListener('focus', preload, { once: true });
            fragment.appendChild(link);
          } else {
            fragment.appendChild(document.createTextNode(matchText));
          }
          lastIndex = matchIndex + matchText.length;
        });

        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }
        textNode.parentNode.replaceChild(fragment, textNode);
      });

      return container.innerHTML;
    };

    #updateAllLinkStates() {
      const openIds = new Set(this.#stateManager.getState().ui.openPopups.keys());
      document.querySelectorAll('a.rule-link').forEach((link) => {
        const id = link.dataset.popupId;
        if (id) link.classList.toggle(CONFIG.CSS.LINK_DISABLED, openIds.has(id));
      });
    }

    #updateCloseBtnVisibility = () => this.#closeAllBtn?.classList.toggle(CONFIG.CSS.IS_VISIBLE, this.#stateManager.getState().ui.openPopups.size > 1);

    #updateURLHash() {
      const openIds = Array.from(this.#stateManager.getState().ui.openPopups.keys());
      const hash = openIds.map(this.#toShortId).join(',');
      history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname + window.location.search);
    }

    #closePopup = (id) => {
      const state = this.#stateManager.getState();
      const popup = state.ui.openPopups.get(id);
      if (!popup) return;
      popup.classList.add(CONFIG.CSS.IS_CLOSING);
      state.ui.openPopups.delete(id);
      this.#a11yService.announce(`Closed popup for ${id.split('::')[1]}`);
      this.#updateAllLinkStates();
      if (this.#isMobileView) this.#popupContainer.classList.remove(CONFIG.CSS.POPUP_CONTAINER_MODAL_OPEN);
      document.body.style.setProperty('--is-modal-open', state.ui.openPopups.size > 0 ? '1' : '0');
      setTimeout(() => {
        popup.close();
        popup.remove();
        this.#updateCloseBtnVisibility();
      }, CONFIG.ANIMATION_DURATION.POPUP_MS);
      this.#persistenceService.saveSession();
      this.#updateCloseBtnVisibility();
      this.#updateURLHash();
    };

    #handleKeyDown = (e) => {
      const state = this.#stateManager.getState();
      if (e.key !== 'Escape' || state.ui.openPopups.size === 0) return;
      let topId = null; let maxZ = -1;
      state.ui.openPopups.forEach((el, id) => { const z = parseInt(el.style.zIndex || 0, 10); if (z > maxZ) { maxZ = z; topId = id; } });
      if (topId) this.#closePopup(topId);
    };

    #bringToFront(popup) {
      if (popup.classList.contains(CONFIG.CSS.IS_ACTIVE)) return;
      this.#popupContainer.querySelectorAll(`.${CONFIG.CSS.POPUP_WINDOW}`).forEach((w) => w.classList.remove(CONFIG.CSS.IS_ACTIVE));
      const state = this.#stateManager.getState();
      state.ui.activeZIndex++;
      popup.style.zIndex = String(state.ui.activeZIndex);
      popup.classList.add(CONFIG.CSS.IS_ACTIVE);
      this.#persistenceService.saveSession();
    }

    #makeDraggable(popup) {
      const header = popup.querySelector('.popup-header');
      if (!header) return;
      const onMouseDown = (mdEvent) => {
        if (!(mdEvent.target instanceof HTMLElement) || mdEvent.target.closest(`.${CONFIG.CSS.POPUP_CLOSE_BTN}`)) return;
        mdEvent.preventDefault();
        this.#bringToFront(popup);
        header.classList.add(CONFIG.CSS.IS_DRAGGING);
        const rect = popup.getBoundingClientRect();
        const offX = mdEvent.clientX - rect.left;
        const offY = mdEvent.clientY - rect.top;
        const onMouseMove = (mmEvent) => {
          const PADDING = CONFIG.LAYOUT.POPUP_VIEWPORT_PADDING_PX;
          const newLeft = Math.max(PADDING, Math.min(mmEvent.clientX - offX, window.innerWidth - popup.offsetWidth - PADDING));
          const newTop = Math.max(PADDING, Math.min(mmEvent.clientY - offY, window.innerHeight - popup.offsetHeight - PADDING));
          popup.style.left = `${newLeft}px`;
          popup.style.top = `${newTop}px`;
        };
        const onMouseUp = () => {
          header.classList.remove(CONFIG.CSS.IS_DRAGGING);
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          this.#persistenceService.saveSession();
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      };
      header.addEventListener('mousedown', onMouseDown);
    }

    #createPopup(id, ruleInfo, pos) {
      const popup = this.#popupFactory.create(id, ruleInfo, this.#linkifyContent);
      if (this.#isMobileView) {
        popup.classList.add(CONFIG.CSS.POPUP_MODAL);
        this.#popupContainer.classList.add(CONFIG.CSS.POPUP_CONTAINER_MODAL_OPEN);
      } else {
        if (pos?.top && pos?.left) { popup.style.top = pos.top; popup.style.left = pos.left; } else {
          const offset = (this.#stateManager.getState().ui.openPopups.size % CONFIG.LAYOUT.POPUP_CASCADE_WRAP_COUNT) * CONFIG.LAYOUT.POPUP_CASCADE_OFFSET_PX;
          popup.style.top = `${50 + offset}px`; popup.style.left = `${100 + offset}px`;
        }
        popup.addEventListener('mousedown', () => this.#bringToFront(popup), true);
        this.#makeDraggable(popup);
      }
      this.#popupContainer.appendChild(popup);

      if (document.startViewTransition) {
        document.startViewTransition(() => popup.show());
      } else {
        popup.show();
      }

      const state = this.#stateManager.getState();
      popup.style.zIndex = pos?.zIndex || String(++state.ui.activeZIndex);
      state.ui.openPopups.set(id, popup);
      document.body.style.setProperty('--is-modal-open', '1');
      this.#a11yService.announce(`Opened popup for ${ruleInfo.ruleData.title}`);
      this.#updateAllLinkStates();
      this.#updateCloseBtnVisibility();
      this.#persistenceService.saveSession();
      this.#updateURLHash();
      popup.querySelector('.popup-content')?.focus();
    }

    #handleResize = () => { this.#isMobileView = window.innerWidth < CONFIG.LAYOUT.DESKTOP_BREAKPOINT_MIN_PX; };

    #handleContainerClick = (e) => {
      const { target } = e;
      if (target.closest(`.${CONFIG.CSS.POPUP_CLOSE_BTN}`)) {
        const popup = target.closest(`.${CONFIG.CSS.POPUP_WINDOW}`);
        const popupId = Array.from(this.#stateManager.getState().ui.openPopups.entries()).find(([, p]) => p === popup)?.[0];
        if (popupId) this.#closePopup(popupId);
      }
      const link = target.closest('a.rule-link');
      if (link && !link.classList.contains(CONFIG.CSS.LINK_DISABLED) && link.dataset.popupId) {
        e.preventDefault();
        this.togglePopup(link.dataset.popupId);
      }
      const toggleBtn = target.closest('.popup-toggle-details-btn');
      if (toggleBtn) {
        const popup = toggleBtn.closest('.popup-window');
        if (popup) {
          const summary = popup.querySelector('.popup-summary');
          const bullets = popup.querySelector('.popup-bullets');
          const isCurrentlyHidden = bullets.classList.contains('hidden');
          bullets.classList.toggle('hidden', !isCurrentlyHidden);
          summary.classList.toggle('hidden', isCurrentlyHidden);
          toggleBtn.textContent = isCurrentlyHidden ? 'Tell Me Less' : 'Tell Me More';
          toggleBtn.setAttribute('aria-expanded', String(isCurrentlyHidden));
        }
      }
    };

    #handleHashChange = () => {
      const state = this.#stateManager.getState();
      let idsFromHash = new Set();

      // URLPattern API Implementation for Routing
      if ('URLPattern' in window) {
        const pattern = new URLPattern({ hash: '*' });
        const match = pattern.exec(window.location.href);
        if (match && match.hash.input) {
          // URLPattern gives us the raw hash, we still need to split it for multi-window support
          // But we can use it to validate the structure if needed.
          // For now, we stick to the logic that works for comma-separated lists
          idsFromHash = new Set(match.hash.input.substring(1).split(',').filter(Boolean).map(this.#fromShortId));
        }
      } else {
        // Fallback
        idsFromHash = new Set(window.location.hash.substring(1).split(',').filter(Boolean).map(this.#fromShortId));
      }

      const openIds = new Set(state.ui.openPopups.keys());
      [...openIds].filter((id) => !idsFromHash.has(id)).forEach((id) => this.#closePopup(id));
      [...idsFromHash].filter((id) => !openIds.has(id)).forEach((id) => this.togglePopup(id));
    };

    togglePopup(id) {
      const state = this.#stateManager.getState();
      if (state.ui.openPopups.has(id)) this.#closePopup(id);
      else {
        const rule = state.data.ruleMap.get(id);
        if (rule) this.#createPopup(id, rule);
        else {
          this.#a11yService.announce(CONFIG.UI_STRINGS.RULE_NOT_FOUND);
          this.#viewRenderer.showNotification(CONFIG.UI_STRINGS.RULE_NOT_FOUND, 'error');
        }
      }
    }

    createPopupFromState(state) { const rule = this.#stateManager.getState().data.ruleMap.get(state.id); if (rule) this.#createPopup(state.id, rule, state); }

    loadPopupsFromURL() { this.#handleHashChange(); }

    closeAllPopups = () => [...this.#stateManager.getState().ui.openPopups.keys()].forEach((id) => this.#closePopup(id));

    getTopMostPopupId() {
      const state = this.#stateManager.getState();
      if (state.ui.openPopups.size === 0) return null;
      let topId = null; let maxZ = -1;
      state.ui.openPopups.forEach((el, id) => { const z = parseInt(el.style.zIndex || '0', 10); if (z > maxZ) { maxZ = z; topId = id; } });
      return topId;
    }
  }

  class UIController {
    #domProvider;

    #stateManager;

    #services;

    #components;

    constructor(domProvider, stateManager, services, components) {
      this.#domProvider = domProvider;
      this.#stateManager = stateManager;
      this.#services = services;
      this.#components = components;
    }

    initialize() {
      this.setupEventSubscriptions();
      this.applyInitialSettings();
      this.setupSettingsHandlers();
      this.setupCookieNoticeHandler();
      this.bindGlobalEventListeners();
      this.#components.viewRenderer.updateCopyrightYear();
      this.#handleShareTarget();
    }

    setupEventSubscriptions() {
      this.#stateManager.subscribe('settingChanged', this.#handleSettingChangeEvent.bind(this));
      this.#stateManager.subscribe('favoritesChanged', () => {
        this.#components.viewRenderer.renderFavoritesSection();
        // Re-initialize drag and drop after render
        new DragDropManager(CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER, this.#services.userData);
      });
      this.#stateManager.subscribe('externalStateChange', this.#handleExternalStateChange.bind(this));
    }

    applyInitialSettings() {
      const { settings } = this.#stateManager.getState();
      this.#components.viewRenderer.applyAppearance(settings);
      this.#components.viewRenderer.applyMotionReduction(settings.reduceMotion);
      this.#services.wakeLock.setEnabled(settings.keepScreenOn);
    }

    async #switchRuleset() {
      this.#components.windowManager.closeAllPopups();
      await this.#services.data.ensureAllDataLoadedForActiveRuleset();
      this.#services.data.buildRuleMap();
      this.#services.data.buildLinkerData();
      this.#components.viewRenderer.renderFavoritesSection();

      const rerenderPromises = [];
      this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}[data-section]`).forEach((section) => {
        const sectionId = section.getAttribute('id');
        if (sectionId === CONFIG.ELEMENT_IDS.SECTION_FAVORITES || sectionId === 'section-settings') return;
        const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
        if (content) {
          content.setAttribute(CONFIG.ATTRIBUTES.RENDERED, 'false');
          const row = content.querySelector('.section-row');
          if (row) row.innerHTML = '';
        }
        if (!section.classList.contains(CONFIG.CSS.IS_COLLAPSED)) rerenderPromises.push(this.renderSectionContent(section));
      });
      await Promise.all(rerenderPromises);
    }

    #handleSettingChangeEvent = async ({ key, value }) => {
      this.#services.a11y.announce(`Setting updated: ${key.toLowerCase().replace('_', ' ')}.`);
      const { settings } = this.#stateManager.getState();
      if (key === 'RULES_2024') await this.#switchRuleset();
      else if (key === 'THEME' || key === 'MODE') this.#components.viewRenderer.applyAppearance(settings);
      else if (key === 'REDUCE_MOTION') this.#components.viewRenderer.applyMotionReduction(value);
      else if (key === 'WAKE_LOCK') this.#services.wakeLock.setEnabled(value);
      else this.#components.viewRenderer.filterRuleItems();
    };

    #handleExternalStateChange = ({ type, payload }) => {
      const { settings } = this.#stateManager.getState();
      if (type === 'SETTING_CHANGE') {
        this.#services.settings.update(CONFIG.STORAGE_KEYS[payload.key], payload.value, false);
        const config = CONFIG.SETTINGS_CONFIG.find((c) => c.key === payload.key);
        if (config) {
          const el = this.#domProvider.get(config.id);
          if (el.type === 'checkbox') el.checked = payload.value;
          else el.value = payload.value;
        }
      } else if (type === 'FAVORITE_TOGGLE') {
        this.#services.userData.toggleFavorite(payload.id, false);
      } else if (type === 'NOTE_UPDATE') {
        this.#services.userData.saveNote(payload.id, payload.text, false);
      }
    };

    #handleShareTarget = () => {
      const params = new URLSearchParams(window.location.search);
      const title = params.get('title');
      const text = params.get('text');
      if (title || text) {
        const query = (text || title || '').trim();
        if (query) {
          this.#components.viewRenderer.showNotification(`Shared content received: ${query}`);
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    };

    async loadAndPopulateThemes() {
      try {
        const response = await fetch(CONFIG.THEME_CONFIG.MANIFEST);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const manifest = await response.json();
        const selectEl = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_SELECT);
        selectEl.innerHTML = '';
        manifest.themes.forEach((theme) => {
          const option = document.createElement('option');
          option.value = theme.id;
          option.textContent = theme.displayName;
          selectEl.appendChild(option);
        });
      } catch (e) {
        console.error('Fatal: Could not load theme manifest.', e);
        this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_SELECT).innerHTML = '<option value="original">Original</option>';
      }
    }

    setupCollapsibleSections = () => {
      this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_TITLE}`).forEach((header) => {
        const section = header.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`);
        if (!section || section.dataset.section === 'settings' || section.dataset.section === 'favorites') return;
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        const isExpanded = !section.classList.contains(CONFIG.CSS.IS_COLLAPSED);
        header.setAttribute('aria-expanded', String(isExpanded));
        const handler = async () => {
          const collapsed = section.classList.toggle(CONFIG.CSS.IS_COLLAPSED);
          header.setAttribute('aria-expanded', String(!collapsed));
          if (!collapsed) await this.renderSectionContent(section);
          this.#services.a11y.announce(`${section.dataset.section} section ${collapsed ? 'collapsed' : 'expanded'}.`);
        };
        header.addEventListener('click', handler);
        header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });
    };

    bindGlobalEventListeners = () => {
      const mainArea = this.#domProvider.get(CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA);
      mainArea.addEventListener('click', this.#handleMainAreaClick);
      mainArea.addEventListener('keydown', this.#handleMainAreaKeydown);
      try { this.#domProvider.get(CONFIG.ELEMENT_IDS.REPORT_RULE_BTN).addEventListener('click', this.#handleReportClick); } catch (e) { console.warn('Report rule button not found.'); }
      try { this.#domProvider.get(CONFIG.ELEMENT_IDS.EXPORT_NOTES_BTN).addEventListener('click', () => this.#services.userData.exportNotes()); } catch (e) { console.warn('Export notes button not found.'); }
    };

    #handleReportClick = () => {
      const topId = this.#components.windowManager.getTopMostPopupId();
      const repoUrl = 'https://github.com/NatsumeAoii/dnd5e-quickref/issues/new';
      let issueUrl;
      if (topId) {
        const title = `Rule Report: ${topId.replace('::', ' - ')}`;
        const body = `I'd like to report an issue with the following rule:\n\nRule ID: \`${topId}\`\n\nIssue: \n(Please describe the problem, e.g., typo, incorrect information, missing detail)\n\n/Reference (if any): \n(e.g., PHB p.123)\n`;
        issueUrl = `${repoUrl}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
      } else {
        const title = 'General Rule Report';
        const body = 'I\'d like to report a missing rule or a general issue.\n\nIssue: \n\n(Please describe the problem)\n';
        issueUrl = `${repoUrl}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
      }
      window.open(issueUrl, '_blank', 'noopener,noreferrer');
    };

    #handleMainAreaClick = (e) => {
      const item = e.target.closest(`.${CONFIG.CSS.ITEM_CLASS}`);
      if (!item) return;
      const id = item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID);
      if (!id) return;

      if (e.target.closest('.favorite-btn')) {
        this.#services.userData.toggleFavorite(id);
        const isFav = this.#services.userData.isFavorite(id);
        this.#domProvider.queryAll(`[${CONFIG.ATTRIBUTES.POPUP_ID}="${id}"]`).forEach((el) => {
          el.querySelector('.favorite-btn')?.classList.toggle(CONFIG.CSS.IS_FAVORITED, isFav);
        });
        this.#services.a11y.announce(`${id.split('::')[1]} ${isFav ? 'added to' : 'removed from'} favorites.`);
      } else if (e.target.closest('.item-content')) {
        this.#components.windowManager.togglePopup(id);
      }
    };

    #handleMainAreaKeydown = (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const target = e.target.closest('.item-content'); if (target) { e.preventDefault(); target.click(); } };

    async renderSectionContent(section) {
      const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
      if (!content || content.getAttribute(CONFIG.ATTRIBUTES.RENDERED) === 'true') return;
      const dataSectionKey = section.getAttribute(CONFIG.ATTRIBUTES.SECTION_KEY);

      if (dataSectionKey === 'environment') {
        await this.#services.data.ensureSectionDataLoaded('environment');
        this.#services.data.buildRuleMap();
        CONFIG.SECTION_CONFIG.filter((c) => c.type === 'Environment').forEach(this.#renderSingleSection);
      } else {
        const dataKey = dataSectionKey.replace('-', '');
        await this.#services.data.ensureSectionDataLoaded(dataKey);
        this.#services.data.buildRuleMap();
        const sectionConfig = CONFIG.SECTION_CONFIG.find((c) => c.dataKey === dataKey);
        if (sectionConfig) this.#renderSingleSection(sectionConfig);
      }
      content.setAttribute(CONFIG.ATTRIBUTES.RENDERED, 'true');
    }

    #renderSingleSection = (section) => {
      const state = this.#stateManager.getState();
      const srcKey = this.#services.data.getDataSourceKey(section.dataKey);
      const { use2024Rules } = state.settings;
      const rulesetKey = use2024Rules ? '2024' : '2014';
      const src = state.data.rulesets[rulesetKey][srcKey];
      if (!Array.isArray(src)) { console.warn(`Data source for "${section.dataKey}" is missing.`); return; }
      let rules = src;
      if (section.dataKey.startsWith('environment_')) rules = src.filter((d) => d.tags?.includes(section.dataKey));
      const rulesWithIds = rules.map((rule) => ({
        popupId: `${section.type}::${rule.title}`,
        ruleInfo: { ruleData: rule, type: section.type, sectionId: section.id },
      }));
      try { this.#components.viewRenderer.renderSection(section.id, rulesWithIds); } catch (e) { console.error(`Failed to render section "${section.id}":`, e); }
    };

    setupCookieNoticeHandler = () => {
      try {
        const notice = this.#domProvider.get(CONFIG.ELEMENT_IDS.COOKIE_NOTICE);
        const acceptBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.ACCEPT_COOKIES_BTN);
        const remindBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.REMIND_COOKIES_LATER_BTN);
        const hasAccepted = window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true';
        const hasDismissedReminder = window.sessionStorage.getItem(CONFIG.SESSION_STORAGE_KEYS.COOKIES_REMINDER_DISMISSED) === 'true';

        if (!hasAccepted && !hasDismissedReminder) notice.style.display = 'block';
        const dismissNotice = () => {
          notice.classList.add(CONFIG.CSS.IS_CLOSING);
          notice.addEventListener('animationend', () => { notice.style.display = 'none'; }, { once: true });
        };
        acceptBtn.addEventListener('click', () => {
          window.localStorage.setItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED, 'true');
          ServiceWorkerMessenger.setCachingPolicy(true);
          dismissNotice();
        });
        remindBtn.addEventListener('click', () => {
          window.sessionStorage.setItem(CONFIG.SESSION_STORAGE_KEYS.COOKIES_REMINDER_DISMISSED, 'true');
          dismissNotice();
        });
      } catch (e) { console.warn(`Could not set up cookie notice: ${e.message}`); }
    };

    setupSettingsHandlers = () => {
      CONFIG.SETTINGS_CONFIG.forEach(({
        id, key, stateProp, type,
      }) => {
        try {
          const el = this.#domProvider.get(id);
          const { settings } = this.#stateManager.getState();
          if (type === 'checkbox' && el instanceof HTMLInputElement) {
            el.checked = settings[stateProp];
            el.addEventListener('change', () => this.#services.settings.update(CONFIG.STORAGE_KEYS[key], el.checked));
          } else if (type === 'select' && el instanceof HTMLSelectElement) {
            el.value = settings[stateProp];
            el.addEventListener('change', () => this.#services.settings.update(CONFIG.STORAGE_KEYS[key], el.value));
          }
        } catch (e) { console.warn(`Failed to set up setting #${id}: ${e.message}`); }
      });
    };
  }

  class QuickRefApplication {
    #stateManager;

    #services = {};

    #components = {};

    #domProvider;

    #uiController;

    constructor() {
      this.#domProvider = new DOMProvider();
      this.#stateManager = new StateManager();
      this.#registerServices();
      this.#registerComponents();
      this.#uiController = new UIController(this.#domProvider, this.#stateManager, this.#services, this.#components);
    }

    #registerServices() {
      this.#services.a11y = new A11yService(this.#domProvider);
      this.#services.sync = new SyncService(this.#stateManager);
      this.#services.optimizer = new PerformanceOptimizer();
      this.#services.settings = new SettingsService(window.localStorage, this.#stateManager, this.#services.sync, this.#services.optimizer);
      this.#services.db = new DBService();
      this.#services.userData = new UserDataService(window.localStorage, this.#stateManager, this.#services.db, this.#services.sync);
      this.#services.persistence = new PersistenceService(window.sessionStorage, this.#stateManager);
      this.#services.data = new DataService(this.#stateManager);
      this.#services.wakeLock = new WakeLockService();
      this.#services.gamepad = new GamepadService(this.#domProvider);
    }

    #registerComponents() {
      const templateService = new TemplateService(this.#domProvider);
      this.#components.viewRenderer = new ViewRenderer(this.#domProvider, this.#stateManager, this.#services.userData, templateService);
      const popupFactory = new PopupFactory(templateService, this.#services.userData, this.#stateManager);
      this.#components.windowManager = new WindowManager({
        domProvider: this.#domProvider,
        stateManager: this.#stateManager,
        persistence: this.#services.persistence,
        a11y: this.#services.a11y,
        popupFactory,
        viewRenderer: this.#components.viewRenderer,
        data: this.#services.data,
      });
    }

    async initialize() {
      this.#handlePageLoadActions();
      this.#registerServiceWorkerAndPreload();
      window.addEventListener('pagehide', this.#handlePageHide);

      // Font Loading API Check
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      await this.#uiController.loadAndPopulateThemes();
      this.#services.settings.initialize();
      await this.#services.userData.initialize();
      this.#components.windowManager.initialize();
      this.#uiController.initialize();
      await this.#loadInitialDataAndRender();
      this.#components.viewRenderer.showApp();
    }

    async #loadInitialDataAndRender() {
      this.#uiController.setupCollapsibleSections();
      const defaultOpenSections = this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not(.${CONFIG.CSS.IS_COLLAPSED})`);
      const renderPromises = Array.from(defaultOpenSections).map((section) => {
        const sectionId = section.getAttribute('id');
        if (sectionId !== CONFIG.ELEMENT_IDS.SECTION_FAVORITES && sectionId !== 'section-settings') {
          return this.#uiController.renderSectionContent(section);
        }
        return Promise.resolve();
      });
      await Promise.all(renderPromises);
      this.#services.data.buildRuleMap();
      this.#services.data.buildLinkerData();
      this.#components.viewRenderer.renderFavoritesSection();
      const popupsFromSession = this.#services.persistence.loadSession();
      if (window.location.hash) this.#components.windowManager.loadPopupsFromURL();
      else popupsFromSession.forEach((p) => this.#components.windowManager.createPopupFromState(p));
    }

    #handlePageLoadActions = () => {
      if (window.sessionStorage.getItem(CONFIG.SESSION_STORAGE_KEYS.RULESET_CHANGED) === 'true') {
        window.scrollTo(0, 0);
        window.sessionStorage.removeItem(CONFIG.SESSION_STORAGE_KEYS.RULESET_CHANGED);
      }
    };

    #handlePageHide = () => {
      const { openPopups } = this.#stateManager.getState().ui;
      if (openPopups.size > 0) {
        openPopups.forEach((popupEl, id) => {
          const textarea = popupEl.querySelector('.popup-notes-textarea');
          if (textarea) this.#services.userData.saveNote(id, textarea.value);
        });
      }
      const hasAccepted = window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true';
      if (!hasAccepted) ServiceWorkerMessenger.clearCache();
    };

    #registerServiceWorkerAndPreload() {
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          const swPath = './sw.js';
          const swUrl = safeScriptURL(swPath);
          navigator.serviceWorker.register(swUrl)
            .then((reg) => {
              console.log('Service Worker registered.', reg);
              return navigator.serviceWorker.ready;
            })
            .then(() => {
              const hasAccepted = window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true';
              ServiceWorkerMessenger.setCachingPolicy(hasAccepted);
              this.#services.data.preloadAllDataSilent();
            })
            .catch((err) => {
              console.error('Service Worker registration or setup failed:', err);
              this.#services.data.preloadAllDataSilent();
            });
        });
      } else {
        this.#services.data.preloadAllDataSilent();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      const app = new QuickRefApplication();
      app.initialize().catch((error) => {
        console.error('Fatal Error during application startup:', error);
        const vr = new ViewRenderer(new DOMProvider());
        vr.renderFatalError('Error loading application data. Please try again later.');
      });
    } catch (error) {
      console.error('A critical error occurred during application initialization:', error);
      const vr = new ViewRenderer(new DOMProvider());
      const msg = error instanceof DOMElementNotFoundError ? 'App failed: A critical UI element is missing.' : 'An unexpected error occurred. Please refresh.';
      vr.renderFatalError(msg);
    }
  });
}(window, document));
