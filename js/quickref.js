/* eslint-disable no-console */
/* eslint-disable no-new */
import { CONFIG } from './modules/Config.js';
import {
  ServiceWorkerMessenger, DOMProvider, A11yService, DBService, WakeLockService, SyncService, PerformanceOptimizer, GamepadService, SettingsService, UserDataService, PersistenceService,
} from './modules/Services.js';
import { StateManager } from './modules/StateManager.js';
import { DataService } from './modules/DataService.js';
import {
  TemplateService, ViewRenderer, PopupFactory, WindowManager, UIController,
} from './modules/UIComponents.js';

class QuickRefApplication {
  #stateManager;

  #services = {};

  #components = {};

  constructor() {
    try {
      this.#stateManager = new StateManager();
      this.#initializeServices();
      this.#initializeComponents();
      this.#initializeController();
    } catch (error) {
      console.error('Critical initialization error:', error);
      this.#components.viewRenderer?.renderFatalError('Failed to initialize application. Please reload.');
    }
  }

  #initializeServices() {
    const domProvider = new DOMProvider();
    const a11y = new A11yService(domProvider);
    const db = new DBService();
    const wakeLock = new WakeLockService();
    const sync = new SyncService(this.#stateManager);
    const optimizer = new PerformanceOptimizer();
    const gamepad = new GamepadService(domProvider);
    const persistence = new PersistenceService(window.sessionStorage, this.#stateManager);
    const settings = new SettingsService(window.localStorage, this.#stateManager, sync, optimizer);
    const userData = new UserDataService(window.localStorage, this.#stateManager, db, sync);
    const data = new DataService(this.#stateManager);

    this.#services = {
      domProvider, a11y, db, wakeLock, sync, optimizer, gamepad, persistence, settings, userData, data,
    };
  }

  #initializeComponents() {
    const templateService = new TemplateService(this.#services.domProvider);
    const viewRenderer = new ViewRenderer(this.#services.domProvider, this.#stateManager, this.#services.userData, templateService);
    const popupFactory = new PopupFactory(templateService, this.#services.userData, this.#stateManager);
    const windowManager = new WindowManager({
      domProvider: this.#services.domProvider,
      stateManager: this.#stateManager,
      persistence: this.#services.persistence,
      a11y: this.#services.a11y,
      popupFactory,
      viewRenderer,
      data: this.#services.data,
    });

    this.#components = {
      templateService, viewRenderer, popupFactory, windowManager,
    };
  }

  #initializeController() {
    this.#components.controller = new UIController(
      this.#services.domProvider,
      this.#stateManager,
      this.#services,
      this.#components,
    );
  }

  async start() {
    try {
      // 1. Initialize Settings & User Data (Sync)
      this.#services.settings.initialize();
      await this.#services.userData.initialize();

      // 2. Load Theme Manifest (Async)
      await this.#components.controller.loadAndPopulateThemes();

      // 3. Apply Initial Settings (Sync)
      this.#components.controller.applyInitialSettings();

      // 4. Load Data (Async)
      await this.#services.data.ensureAllDataLoadedForActiveRuleset();
      this.#services.data.buildRuleMap();
      this.#services.data.buildLinkerData();

      // 5. Render Initial UI
      this.#components.viewRenderer.renderFavoritesSection();
      this.#components.controller.setupCollapsibleSections();
      await this.#components.controller.renderOpenSections();

      // 6. Restore Session
      const restoredPopups = this.#services.persistence.loadSession();
      restoredPopups.forEach((p) => this.#components.windowManager.createPopupFromState(p));
      this.#components.windowManager.loadPopupsFromURL();

      // 7. Initialize Controller Logic
      this.#components.controller.initialize();
      this.#components.windowManager.initialize();

      // 8. Show App
      this.#components.viewRenderer.showApp();

      // 9. Background Tasks
      this.#services.data.preloadAllDataSilent();
      ServiceWorkerMessenger.setCachingPolicy(window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true');
    } catch (e) {
      console.error('Application start failed:', e);
      this.#components.viewRenderer.renderFatalError('Application failed to start.');
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new QuickRefApplication().start());
} else {
  new QuickRefApplication().start();
}
