import './css/quickref.css';
import './css/icons.css';
import { CONFIG } from './config.js';
import { StateManager } from './state/StateManager.js';
import {
    ServiceWorkerMessenger, DOMProvider, A11yService, DBService, WakeLockService, SyncService,
    PerformanceOptimizer, GamepadService, SettingsService, UserDataService, PersistenceService, DataService,
    ErrorService, OnboardingService, KeyboardShortcutsService, ChangelogService, ReadmeService, NavigationService,
} from './services/index.js';
import {
    TemplateService, ViewRenderer, PopupFactory, WindowManager, UIController,
} from './ui/index.js';
import { installPrintRestoreFallback } from './utils/Utils.js';

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
    errorService: ErrorService;
    onboarding: OnboardingService;
    shortcuts: KeyboardShortcutsService;
    changelog: ChangelogService;
    readme: ReadmeService;
    navigation: NavigationService;
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
    #printInProgress = false;

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
        const errorService = new ErrorService();
        const onboarding = new OnboardingService(window.localStorage, a11y);
        const shortcuts = new KeyboardShortcutsService(a11y);
        const changelog = new ChangelogService(a11y);
        const readme = new ReadmeService(a11y);
        const navigation = new NavigationService(shortcuts, onboarding);

        this.#services = {
            domProvider, a11y, db, wakeLock, sync, optimizer, gamepad, persistence, settings, userData, data,
            errorService, onboarding, shortcuts, changelog, readme, navigation,
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
            this.#components.viewRenderer.renderFavoritesSection();
            this.#components.controller.setupCollapsibleSections();
            await this.#components.controller.renderOpenSections();
            this.#services.navigation.invalidateFocusables();

            const restoredPopups = this.#services.persistence.loadSession();
            restoredPopups.forEach((p) => this.#components.windowManager.createPopupFromState(p));
            this.#components.windowManager.loadPopupsFromURL();

            this.#components.controller.initialize();
            this.#components.windowManager.initialize();
            this.#components.viewRenderer.showApp();

            // Deferred: build linker data after UI is visible (only needed for popup cross-references)
            this.#services.data.buildLinkerData();

            // Background tasks — yielded to idle time to avoid competing with user interactions
            const idleCallback = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
            idleCallback(() => this.#services.data.preloadAllDataSilent());

            // Wire keyboard shortcuts
            this.#registerKeyboardShortcuts();
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
                    ServiceWorkerMessenger.ensureServiceWorkerReady().then((ready) => {
                        let cachingAllowed = false;
                        try {
                            cachingAllowed = window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true';
                        } catch (error) {
                            console.warn('Could not read cache consent state:', error);
                        }
                        if (ready) ServiceWorkerMessenger.setCachingPolicy(cachingAllowed);
                    });
                } catch (error) {
                    console.error('Service Worker registration failed:', error);
                }
            }
        } catch (e) {
            this.#services?.errorService?.report(e, 'Application.start', 'fatal');
            this.#components?.viewRenderer?.renderFatalError('Application failed to start.');
        }
    }

    #registerKeyboardShortcuts(): void {
        const s = this.#services.shortcuts;

        // Close topmost popup
        s.register('Esc', 'Close topmost popup', 'Popups', () => {
            const topId = this.#components.windowManager.getTopMostPopupId();
            if (topId) this.#components.windowManager.togglePopup(topId);
        });

        // Toggle all sections
        s.register('Ctrl+E', 'Expand/collapse all sections', 'Navigation', () => {
            const sections = document.querySelectorAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not([data-section="settings"]):not([data-section="favorites"])`);
            const allCollapsed = Array.from(sections).every((el) => el.classList.contains(CONFIG.CSS.IS_COLLAPSED));
            sections.forEach((el) => {
                el.classList.toggle(CONFIG.CSS.IS_COLLAPSED, !allCollapsed);
                el.querySelector(`.${CONFIG.CSS.SECTION_TITLE}`)?.setAttribute('aria-expanded', String(allCollapsed));
            });
            // Persist all states and trigger lazy-render if expanding
            this.#components.controller.persistAllSectionStates();
            if (allCollapsed) this.#components.controller.renderOpenSections();
            this.#services.navigation.invalidateFocusables();
        });

        // Print
        s.register('Ctrl+P', 'Print quick reference', 'Tools', () => {
            void this.#printQuickReference();
        });

        // Scroll to top
        s.register('t', 'Scroll to top', 'Navigation', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Close all popups
        s.register('Ctrl+W', 'Close all popups', 'Popups', () => {
            this.#components.windowManager.closeAllPopups();
        });

    }

    async #printQuickReference(): Promise<void> {
        if (this.#printInProgress) return;
        this.#printInProgress = true;
        const expandedForPrint: HTMLElement[] = [];
        let restored = false;
        const restorePrintState = (): void => {
            if (restored) return;
            restored = true;
            document.body.classList.remove(CONFIG.CSS.PRINT_MODE);
            expandedForPrint.forEach((el) => {
                el.classList.add(CONFIG.CSS.IS_COLLAPSED);
                el.querySelector(`.${CONFIG.CSS.SECTION_TITLE}`)?.setAttribute('aria-expanded', 'false');
            });
            this.#services.navigation.invalidateFocusables();
        };

        try {
            document.body.classList.add(CONFIG.CSS.PRINT_MODE);
            document.querySelectorAll(`.${CONFIG.CSS.SECTION_CONTAINER}.${CONFIG.CSS.IS_COLLAPSED}`).forEach((el) => {
                const section = el as HTMLElement;
                expandedForPrint.push(section);
                section.classList.remove(CONFIG.CSS.IS_COLLAPSED);
                section.querySelector(`.${CONFIG.CSS.SECTION_TITLE}`)?.setAttribute('aria-expanded', 'true');
            });
            await this.#components.controller.renderOpenSections();
            this.#services.navigation.invalidateFocusables();
            this.#services.a11y.announce('Print view ready');
            installPrintRestoreFallback(
                restorePrintState,
                CONFIG.ANIMATION_DURATION.SECTION_TRANSITION_MS * 4,
            );
            window.print();
        } catch (error) {
            restorePrintState();
            this.#services.errorService.warn(error instanceof Error ? error.message : String(error), 'Print');
        } finally {
            this.#printInProgress = false;
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new QuickRefApplication().start());
} else {
    new QuickRefApplication().start();
}
