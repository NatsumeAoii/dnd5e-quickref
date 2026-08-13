import './css/critical.css';
import './css/quickref.css';
import './css/icons.css';
import { CONFIG } from './config.js';
import { StateManager } from './state/StateManager.js';
import {
    ServiceWorkerMessenger, DOMProvider, A11yService, DBService, WakeLockService, SyncService,
    PerformanceOptimizer, GamepadService, SettingsService, UserDataService, PersistenceService, DataService,
    ErrorService, OnboardingService, KeyboardShortcutsService, ChangelogService, ReadmeService, NavigationService,
    LocalizationService, BackupService, StorageCapabilityService,
} from './services/index.js';
import {
    TemplateService, ViewRenderer, PopupFactory, WindowManager, UIController,
} from './ui/index.js';
import { AppShortcutsController } from './ui/AppShortcutsController.js';
import { ensureDOMPurifyLoaded } from './utils/Utils.js';
import { benchmarkUtility } from './utils/BenchmarkUtility.js';
import { reportWebVitals } from './utils/webVitals.js';

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
    localization: LocalizationService;
    userData: UserDataService;
    data: DataService;
    errorService: ErrorService;
    onboarding: OnboardingService;
    shortcuts: KeyboardShortcutsService;
    changelog: ChangelogService;
    readme: ReadmeService;
    navigation: NavigationService;
    backup: BackupService;
    storageCapability: StorageCapabilityService;
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
    #appShortcuts!: AppShortcutsController;
    #destroyed = false;

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
        const localization = new LocalizationService();
        const userData = new UserDataService(window.localStorage, this.#stateManager, db, sync);
        const data = new DataService(this.#stateManager);
        const errorService = new ErrorService();
        const onboarding = new OnboardingService(window.localStorage, a11y, localization);
        const shortcuts = new KeyboardShortcutsService(a11y, localization);
        const changelog = new ChangelogService(a11y, localization);
        const readme = new ReadmeService(a11y, localization);
        const navigation = new NavigationService(shortcuts, onboarding);
        const backup = new BackupService(this.#stateManager, db, userData);
        const storageCapability = new StorageCapabilityService();

        this.#services = {
            domProvider, a11y, db, wakeLock, sync, optimizer, gamepad, persistence, settings, userData, data,
            errorService, onboarding, shortcuts, changelog, readme, navigation, localization, backup, storageCapability,
        };
    }

    #initializeComponents(): void {
        const templateService = new TemplateService(this.#services.domProvider, this.#services.localization);
        const viewRenderer = new ViewRenderer(
            this.#services.domProvider,
            this.#stateManager,
            this.#services.userData,
            templateService,
            this.#services.localization,
        );
        const popupFactory = new PopupFactory(templateService, this.#services.userData, this.#stateManager);
        const windowManager = new WindowManager({
            domProvider: this.#services.domProvider,
            stateManager: this.#stateManager,
            persistence: this.#services.persistence,
            a11y: this.#services.a11y,
            popupFactory,
            data: this.#services.data,
            localization: this.#services.localization,
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
            benchmarkUtility.mark('domContentLoaded');

            this.#services.settings.initialize();
            await this.#services.localization.loadAndApply(this.#stateManager.getState().settings.locale);
            await this.#services.userData.initialize();
            this.#components.controller.applyInitialSettings();

            // Load DOMPurify async chunk, theme manifest, and data in parallel
            await Promise.all([
                ensureDOMPurifyLoaded(),
                this.#components.controller.loadAndPopulateThemes(),
                this.#services.data.ensureAllDataLoadedForActiveRuleset(),
            ]);

            benchmarkUtility.mark('dataLoaded');

            this.#services.data.buildRuleMap();
            await this.#services.userData.migrateLegacyReferences();
            this.#components.viewRenderer.renderFavoritesSection();
            this.#components.controller.setupCollapsibleSections();
            await this.#components.controller.renderOpenSections();
            this.#services.navigation.invalidateFocusables();

            benchmarkUtility.mark('firstSectionRendered');

            const restoredPopups = this.#services.persistence.loadSession();
            restoredPopups.forEach((p) => this.#components.windowManager.createPopupFromState(p));
            this.#components.windowManager.loadPopupsFromURL();

            this.#components.controller.initialize();
            this.#components.windowManager.initialize();
            this.#components.viewRenderer.showApp();

            benchmarkUtility.mark('appVisible');

            // Report Core Web Vitals in production mode
            reportWebVitals((metric) => {
                console.info(`[WebVitals] ${metric.name}:`, metric.value.toFixed(2), `(id: ${metric.id})`);
            });

            // Deferred: build linker data after UI is visible (only needed for popup cross-references)
            this.#services.data.buildLinkerData();

            // Background tasks — yielded to idle time to avoid competing with user interactions
            const idleCallback = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
            idleCallback(() => this.#services.data.preloadAllDataSilent());

            // Wire keyboard shortcuts
            this.#appShortcuts = new AppShortcutsController({
                stateManager: this.#stateManager,
                shortcuts: this.#services.shortcuts,
                navigation: this.#services.navigation,
                a11y: this.#services.a11y,
                errorService: this.#services.errorService,
                windowManager: this.#components.windowManager,
                controller: this.#components.controller,
            });
            this.#appShortcuts.register();
            this.#services.shortcuts.initialize();
            this.#services.navigation.initialize();

            // Wire shortcuts FAB button
            document.getElementById('shortcuts-fab-btn')?.addEventListener('click', () => {
                this.#services.shortcuts.toggle();
            });

            // Wire changelog modal to version display button
            document.getElementById(CONFIG.ELEMENT_IDS.APP_VERSION_DISPLAY)?.addEventListener('click', () => {
                this.#services.changelog.toggle();
            });

            // Wire README modal to readme display button
            document.getElementById('readme-display-btn')?.addEventListener('click', () => {
                this.#services.readme.toggle();
            });

            // Wire ErrorService notifier
            this.#services.errorService.setNotifier((msg, level) => {
                this.#components.viewRenderer.showNotification(msg, level);
            });

            const startOnboarding = (): void => {
                if (this.#services.onboarding.shouldShow()) this.#services.onboarding.start();
            };
            const cookieNotice = document.getElementById(CONFIG.ELEMENT_IDS.COOKIE_NOTICE);
            if (cookieNotice?.style.display === 'block') {
                window.addEventListener('quickref:cookieNoticeDismissed', () => { setTimeout(startOnboarding, 250); }, { once: true });
            } else {
                setTimeout(startOnboarding, 500);
            }

            if ('serviceWorker' in navigator) {
                try {
                    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
                    console.info('Service Worker registered with scope:', registration.scope);
                    registration.addEventListener('updatefound', () => {
                        const updateWorker = registration.installing;
                        if (!updateWorker) return;
                        updateWorker.addEventListener('statechange', () => {
                            if (updateWorker.state !== 'installed' || !navigator.serviceWorker.controller) return;
                            const prompt = document.getElementById('update-available');
                            prompt?.classList.remove('hidden');
                            document.getElementById('apply-update-btn')?.addEventListener('click', () => {
                                ServiceWorkerMessenger.activateUpdate();
                                navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
                            }, { once: true });
                        });
                    });
                    ServiceWorkerMessenger.ensureServiceWorkerReady().then((ready) => {
                        let cachingAllowed = false;
                        try {
                            cachingAllowed = window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true';
                        } catch (error) {
                            console.warn('Could not read cache consent state:', error);
                        }
                        if (ready) ServiceWorkerMessenger.setCachingPolicy(
                            cachingAllowed,
                            this.#stateManager.getState().settings.locale,
                            this.#stateManager.getState().settings.use2024Rules ? '2024' : '2014',
                        );
                    });
                } catch (error) {
                    console.error('Service Worker registration failed:', error);
                }
            }
        } catch (e) {
            this.#services?.errorService?.report(e, 'Application.start', 'fatal');
            const reference = this.#services?.errorService?.getLastErrorId();
            const message = this.#services?.localization.translate(
                'fatal.message',
                'Application failed to start. Please reload the page.',
            ) ?? 'Application failed to start. Please reload the page.';
            this.#components?.viewRenderer?.renderFatalError(reference ? `${message} (Reference: ${reference})` : message);
        }
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#appShortcuts?.destroy?.();
        this.#components?.controller?.destroy?.();
        this.#components?.windowManager?.destroy?.();
        this.#services?.data?.destroy?.();
        this.#services?.sync?.destroy?.();
        this.#services?.wakeLock?.destroy?.();
        this.#services?.optimizer?.destroy?.();
        this.#stateManager?.destroy?.();
    }

}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new QuickRefApplication().start());
} else {
    new QuickRefApplication().start();
}
