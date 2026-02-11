import './css/quickref.css';
import './css/icons.css';
import { CONFIG } from './config.js';
import { StateManager } from './state/StateManager.js';
import {
    ServiceWorkerMessenger, DOMProvider, A11yService, DBService, WakeLockService, SyncService,
    PerformanceOptimizer, GamepadService, SettingsService, UserDataService, PersistenceService, DataService,
} from './services/index.js';
import {
    TemplateService, ViewRenderer, PopupFactory, WindowManager, UIController,
} from './ui/index.js';

interface Services {
    domProvider: DOMProvider;
    a11y: A11yService;
    db: DBService;
    wakeLock: WakeLockService;
    sync: SyncService;
    optimizer: PerformanceOptimizer;
    gamepad: GamepadService;
    persistence: PersistenceService;
    settings: SettingsService;
    userData: UserDataService;
    data: DataService;
}

interface Components {
    templateService: TemplateService;
    viewRenderer: ViewRenderer;
    popupFactory: PopupFactory;
    windowManager: WindowManager;
    controller: UIController;
}

class QuickRefApplication {
    #stateManager!: StateManager;
    #services!: Services;
    #components!: Components;

    constructor() {
        try {
            this.#stateManager = new StateManager();
            this.#initializeServices();
            this.#initializeComponents();
            this.#initializeController();
        } catch (error) {
            console.error('Critical initialization error:', error);
            this.#components?.viewRenderer?.renderFatalError('Failed to initialize application. Please reload.');
        }
    }

    #initializeServices(): void {
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

    #initializeComponents(): void {
        const templateService = new TemplateService(this.#services.domProvider);
        const viewRenderer = new ViewRenderer(
            this.#services.domProvider,
            this.#stateManager,
            this.#services.userData,
            templateService,
        );
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
        } as Components;
    }

    #initializeController(): void {
        this.#components.controller = new UIController(
            this.#services.domProvider,
            this.#stateManager,
            this.#services,
            this.#components,
        );
    }

    async start(): Promise<void> {
        try {
            this.#services.settings.initialize();
            await this.#services.userData.initialize();
            this.#components.controller.applyInitialSettings();

            // Theme manifest + data loading fire in parallel
            await Promise.all([
                this.#components.controller.loadAndPopulateThemes(),
                this.#services.data.ensureAllDataLoadedForActiveRuleset(),
            ]);

            this.#services.data.buildRuleMap();
            this.#services.data.buildLinkerData();
            this.#components.viewRenderer.renderFavoritesSection();
            this.#components.controller.setupCollapsibleSections();
            await this.#components.controller.renderOpenSections();

            const restoredPopups = this.#services.persistence.loadSession();
            restoredPopups.forEach((p) => this.#components.windowManager.createPopupFromState(p));
            this.#components.windowManager.loadPopupsFromURL();

            this.#components.controller.initialize();
            this.#components.windowManager.initialize();
            this.#components.viewRenderer.showApp();

            // Background tasks — non-blocking
            this.#services.data.preloadAllDataSilent();
            if ('serviceWorker' in navigator) {
                try {
                    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
                    console.log('Service Worker registered with scope:', registration.scope);
                    ServiceWorkerMessenger.ensureServiceWorkerReady().then(() => {
                        ServiceWorkerMessenger.setCachingPolicy(window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true');
                    });
                } catch (error) {
                    console.error('Service Worker registration failed:', error);
                }
            }
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
