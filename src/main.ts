import './css/quickref.css';
import './css/icons.css';
import { CONFIG } from './config.js';
import { StateManager } from './state/StateManager.js';
import {
    ServiceWorkerMessenger, DOMProvider, A11yService, DBService, WakeLockService, SyncService,
    PerformanceOptimizer, GamepadService, SettingsService, UserDataService, PersistenceService, DataService,
    ErrorService, OnboardingService, KeyboardShortcutsService,
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
    errorService: ErrorService;
    onboarding: OnboardingService;
    shortcuts: KeyboardShortcutsService;
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
        const errorService = new ErrorService();
        const onboarding = new OnboardingService(window.localStorage, a11y);
        const shortcuts = new KeyboardShortcutsService(a11y);

        this.#services = {
            domProvider, a11y, db, wakeLock, sync, optimizer, gamepad, persistence, settings, userData, data,
            errorService, onboarding, shortcuts,
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

            // Wire keyboard shortcuts
            this.#registerKeyboardShortcuts();
            this.#services.shortcuts.initialize();

            // Wire shortcuts FAB button
            document.getElementById('shortcuts-fab-btn')?.addEventListener('click', () => {
                this.#services.shortcuts.toggle();
            });

            // Wire ErrorService notifier
            this.#services.errorService.setNotifier((msg, level) => {
                this.#components.viewRenderer.showNotification(msg, level);
            });

            // Start onboarding if new user
            setTimeout(() => {
                if (this.#services.onboarding.shouldShow()) this.#services.onboarding.start();
            }, 500);

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
            this.#services?.errorService?.report(e, 'Application.start', 'fatal');
            this.#components.viewRenderer.renderFatalError('Application failed to start.');
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
        });

        // Print mode toggle
        s.register('Ctrl+P', 'Toggle print mode', 'Tools', () => {
            document.body.classList.toggle(CONFIG.CSS.PRINT_MODE);
            const isPrint = document.body.classList.contains(CONFIG.CSS.PRINT_MODE);
            this.#services.a11y.announce(isPrint ? 'Print mode enabled' : 'Print mode disabled');
            if (isPrint) {
                // Expand all sections for print
                document.querySelectorAll(`.${CONFIG.CSS.SECTION_CONTAINER}.${CONFIG.CSS.IS_COLLAPSED}`).forEach((el) => {
                    el.classList.remove(CONFIG.CSS.IS_COLLAPSED);
                });
                // Trigger rendering of all un-rendered sections
                this.#components.controller.renderOpenSections();
            }
        });

        // Scroll to top
        s.register('t', 'Scroll to top', 'Navigation', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Close all popups
        s.register('Ctrl+W', 'Close all popups', 'Popups', () => {
            this.#components.windowManager.closeAllPopups();
        });

        // Arrow key navigation (document-level)
        document.addEventListener('keydown', (e) => {
            const key = e.key;
            // Fast exit for irrelevant keys — before any DOM queries
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(key)) return;

            if (this.#services.shortcuts.isModalOpen || this.#services.onboarding.isActive) return;
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if ((e.target as HTMLElement).isContentEditable) return;

            const focusables = Array.from<HTMLElement>(
                document.querySelectorAll(`.${CONFIG.CSS.SECTION_TITLE}, .${CONFIG.CSS.SECTION_CONTAINER}:not(.${CONFIG.CSS.IS_COLLAPSED}) .item`)
            ).filter((el) => el.offsetParent !== null);

            if (!focusables.length) return;

            const active = document.activeElement as HTMLElement;
            const currentIdx = focusables.indexOf(active);

            // Enter/Space on focused item — click it
            if ((key === 'Enter' || key === ' ') && currentIdx >= 0) {
                e.preventDefault();
                active.click();
                return;
            }

            // Don't handle Enter/Space if nothing focused in the grid
            if (key === 'Enter' || key === ' ') return;

            e.preventDefault();

            if (key === 'ArrowRight' || key === 'ArrowDown') {
                if (key === 'ArrowDown') {
                    const nextSection = focusables.find((el, i) =>
                        i > currentIdx && el.classList.contains(CONFIG.CSS.SECTION_TITLE)
                    );
                    const target = nextSection ?? focusables[0];
                    target.focus();
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    const nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, focusables.length - 1);
                    focusables[nextIdx].focus();
                    focusables[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            } else {
                if (key === 'ArrowUp') {
                    const searchFrom = currentIdx < 0 ? focusables.length : currentIdx;
                    const prevSections = focusables.filter((el, i) =>
                        i < searchFrom && el.classList.contains(CONFIG.CSS.SECTION_TITLE)
                    );
                    if (prevSections.length) {
                        const prev = prevSections[prevSections.length - 1];
                        prev.focus();
                        prev.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                } else {
                    const prevIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
                    focusables[prevIdx].focus();
                    focusables[prevIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new QuickRefApplication().start());
} else {
    new QuickRefApplication().start();
}
