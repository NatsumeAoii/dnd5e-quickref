import { CONFIG } from '../config.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { A11yService } from '../services/A11yService.js';
import type { WakeLockService } from '../services/WakeLockService.js';
import type { SettingsService } from '../services/SettingsService.js';
import type { LocalizationService } from '../services/LocalizationService.js';
import type { UserDataService } from '../services/UserDataService.js';
import type { DataService } from '../services/DataService.js';
import type { NavigationService } from '../services/NavigationService.js';
import { fetchWithTimeout } from '../utils/Utils.js';
import type { StateManager } from '../state/StateManager.js';
import type { ViewRenderer } from './ViewRenderer.js';
import type { WindowManager } from './WindowManager.js';
import { DragDropManager } from './DragDropManager.js';
import { SearchController } from './SearchController.js';
import { CookieNoticeController } from './CookieNoticeController.js';
import type { ThemeManifest, SectionConfig } from '../types.js';
import type { BackupService } from '../services/BackupService.js';
import type { StorageCapabilityService } from '../services/StorageCapabilityService.js';
import { SectionCategoryController } from './SectionCategoryController.js';
import { SettingsTransitionController } from './SettingsTransitionController.js';
import { DataUserActionController } from './DataUserActionController.js';
import { GlobalInteractionController } from './GlobalInteractionController.js';
import { ServiceWorkerMessenger } from '../services/ServiceWorkerMessenger.js';

interface UIServices {
    a11y: A11yService;
    wakeLock: WakeLockService;
    settings: SettingsService;
    localization: LocalizationService;
    userData: UserDataService;
    data: DataService;
    navigation: NavigationService;
    backup: BackupService;
    storageCapability: StorageCapabilityService;
}

interface UIComponents {
    viewRenderer: ViewRenderer;
    windowManager: WindowManager;
}

export class UIController {
    #domProvider: DOMProvider;
    #stateManager: StateManager;
    #services: UIServices;
    #components: UIComponents;
    #dragDropManager: DragDropManager | null = null;
    // #2: Dirty flag to avoid redundant buildRuleMap() calls on every section expand
    #searchController: SearchController;
    #cookieNoticeController: CookieNoticeController;
    #cachedThemeManifest: ThemeManifest | null = null;
    #unsubscribeStateEvents: (() => void)[] = [];
    #cleanupCallbacks: (() => void)[] = [];
    #sections: SectionCategoryController;
    #settingsTransitions: SettingsTransitionController;
    #dataUserActions: DataUserActionController;
    #globalInteractions: GlobalInteractionController;

    constructor(domProvider: DOMProvider, stateManager: StateManager, services: UIServices, components: UIComponents) {
        this.#domProvider = domProvider;
        this.#stateManager = stateManager;
        this.#services = services;
        this.#components = components;
        this.#globalInteractions = new GlobalInteractionController(domProvider);
        this.#dataUserActions = new DataUserActionController({ domProvider, userData: services.userData, a11y: services.a11y, localization: services.localization, windowManager: components.windowManager });
        this.#sections = new SectionCategoryController({
            domProvider, stateManager, data: services.data, a11y: services.a11y, navigation: services.navigation,
            viewRenderer: components.viewRenderer, renderSingleSection: (section) => this.#renderSingleSection(section), localization: services.localization,
        });
        this.#settingsTransitions = new SettingsTransitionController({
            domProvider, stateManager, settings: services.settings, localization: services.localization, wakeLock: services.wakeLock,
            data: services.data, navigation: services.navigation, a11y: services.a11y, viewRenderer: components.viewRenderer,
            sections: this.#sections, closePopups: () => components.windowManager.closeAllPopups(), refreshFavorites: () => { components.viewRenderer.renderFavoritesSection(); this.#initDragDrop(); },
        });
        this.#searchController = new SearchController({
            domProvider,
            stateManager,
            a11y: services.a11y,
            data: services.data,
            navigation: services.navigation,
            viewRenderer: components.viewRenderer,
            renderSectionContent: (section) => this.renderSectionContent(section),
            localization: services.localization,
        });
        this.#cookieNoticeController = new CookieNoticeController({
            domProvider,
            stateManager,
            localization: services.localization,
            viewRenderer: components.viewRenderer,
        });
    }

    initialize(): void {
        this.#settingsTransitions.initialize();
        this.setupEventSubscriptions();
        this.applyInitialSettings();
        this.#settingsTransitions.setupHandlers();
        this.#cookieNoticeController.initialize();
        this.bindGlobalEventListeners();
        this.#globalInteractions.setupBackToTop();
        this.#components.viewRenderer.updateFooterInfo();
        this.#handleShareTarget();
        this.#initDragDrop();
        this.#searchController.initialize();
        this.#setupBackupControls();
    }

    #initDragDrop(): void {
        this.#dragDropManager?.destroy();
        this.#dragDropManager = new DragDropManager(
            CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER,
            this.#services.userData,
            (message) => this.#services.a11y.announce(message),
        );
    }

    setupEventSubscriptions(): void {
        this.#unsubscribeStateEvents.push(this.#stateManager.subscribe('favoritesChanged', () => {
            this.#components.viewRenderer.renderFavoritesSection();
            this.#initDragDrop();
        }));
        this.#unsubscribeStateEvents.push(this.#stateManager.subscribe('externalStateChange', this.#handleExternalStateChange as (data?: unknown) => void));
    }

    applyInitialSettings(): void {
        this.#settingsTransitions.applyInitialSettings();
    }

    async renderOpenSections(): Promise<void> {
        await this.#sections.renderOpenSections();
    }

    #handleExternalStateChange = (data?: unknown): void => {
        if (!data || typeof data !== 'object') return;
        const { type, payload } = data as { type?: unknown; payload?: unknown };
        if (typeof type !== 'string' || !payload || typeof payload !== 'object') return;
        const safePayload = payload as Record<string, unknown>;
        if (type === 'SETTING_CHANGE') {
            if (typeof safePayload.key !== 'string' || !(safePayload.key in CONFIG.STORAGE_KEYS)) return;
            const config = CONFIG.SETTINGS_CONFIG.find((c) => c.key === safePayload.key);
            if (!config) return;
            if (config.type === 'checkbox' && typeof safePayload.value !== 'boolean') return;
            if (config.type === 'select' && typeof safePayload.value !== 'string') return;
            this.#services.settings.update(CONFIG.STORAGE_KEYS[safePayload.key as keyof typeof CONFIG.STORAGE_KEYS], safePayload.value as boolean | string, false);
            const el = this.#domProvider.get(config.id);
            if ((el as HTMLInputElement).type === 'checkbox') (el as HTMLInputElement).checked = safePayload.value as boolean;
            else (el as HTMLSelectElement).value = safePayload.value as string;
        } else if (type === 'FAVORITE_TOGGLE') {
            if (typeof safePayload.id === 'string') this.#services.userData.toggleFavorite(safePayload.id, false);
        } else if (type === 'NOTE_UPDATE') {
            if (typeof safePayload.id === 'string' && typeof safePayload.text === 'string') this.#services.userData.saveNote(safePayload.id, safePayload.text, false);
        }
    };

    #handleShareTarget = (): void => {
        const params = new URLSearchParams(window.location.search);
        const title = params.get('title');
        const text = params.get('text');
        if (title || text) {
            const query = (text || title || '').trim();
            if (query) {
                this.#components.viewRenderer.showNotification(this.#services.localization.translate('shared.received', 'Shared content received: {query}', { query }));
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    };

    async loadAndPopulateThemes(): Promise<void> {
        try {
            let manifest: ThemeManifest;
            if (this.#cachedThemeManifest) {
                manifest = this.#cachedThemeManifest;
            } else {
                const response = await fetchWithTimeout(CONFIG.THEME_CONFIG.MANIFEST);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                manifest = await response.json() as ThemeManifest;
                this.#cachedThemeManifest = manifest;
            }
            const selectEl = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_SELECT) as HTMLSelectElement;
            const safeThemes = Array.isArray(manifest.themes)
                ? manifest.themes.filter((theme) =>
                    typeof theme.id === 'string' &&
                    /^[a-z0-9_-]{1,64}$/i.test(theme.id) &&
                    typeof theme.displayName === 'string'
                )
                : [];
            const themes = safeThemes.length > 0
                ? safeThemes
                : [{ id: CONFIG.DEFAULTS.THEME, displayName: 'Original' }];
            selectEl.replaceChildren();
            themes.forEach((theme) => {
                const option = document.createElement('option');
                option.value = theme.id;
                option.textContent = theme.displayName;
                selectEl.appendChild(option);

            });
            const state = this.#stateManager.getState();
            if (!themes.some((theme) => theme.id === state.settings.theme)) {
                state.settings.theme = CONFIG.DEFAULTS.THEME;
                this.#components.viewRenderer.applyAppearance(state.settings);
            }
            selectEl.value = state.settings.theme;
        } catch (e) {
            console.error('Fatal: Could not load theme manifest.', e);
            const selectEl = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_SELECT) as HTMLSelectElement;
            const option = document.createElement('option');
            option.value = CONFIG.DEFAULTS.THEME;
            option.textContent = 'Original';
            selectEl.replaceChildren(option);
            selectEl.value = CONFIG.DEFAULTS.THEME;
            const state = this.#stateManager.getState();
            state.settings.theme = CONFIG.DEFAULTS.THEME;
            this.#components.viewRenderer.applyAppearance(state.settings);
        }
    }

    #setupBackupControls(): void {
        const backup = this.#services.backup;
        const capability = this.#services.storageCapability.detect();
        const t = (key: string, fallback: string): string => this.#services.localization.translate(key, fallback);
        this.#components.viewRenderer.showNotification(t('settings.storage.' + capability.capability, capability.message), capability.capability === 'persistent' ? 'info' : 'warning');
        const exportButton = document.getElementById('export-backup-btn');
        exportButton?.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(backup.createBundle(), null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `quickref-backup-${new Date().toISOString().slice(0, 10)}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
        });
        const input = document.getElementById('import-backup-input') as HTMLInputElement | null;
        const importButton = document.getElementById('import-backup-btn');
        importButton?.addEventListener('click', () => input?.click());
        input?.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const parsed = JSON.parse(await file.text()) as unknown;
                const preview = backup.preview(parsed);
                const mode = window.confirm(this.#services.localization.translate('backup.confirmImport', 'Import {favorites} favorites and {notes} notes? Cancel keeps existing data.', { favorites: preview.favorites, notes: preview.notes })) ? 'merge' : null;
                if (mode) await backup.apply(parsed, mode);
                this.#components.viewRenderer.showNotification(this.#services.localization.translate(mode ? 'backup.imported' : 'backup.cancelled', mode ? 'Backup imported successfully.' : 'Backup import cancelled.'), mode ? 'success' : 'info');
            } catch { this.#components.viewRenderer.showNotification(this.#services.localization.translate('backup.importFailed', 'Backup import failed. Check the file and try again.'), 'error'); }
            input.value = '';
        });
        const offlineStatus = document.getElementById('offline-status');
        const cacheDetails = document.getElementById('offline-cache-details');
        const retryButton = document.getElementById('retry-cache-btn');
        const setOfflineStatus = (message: string): void => { if (offlineStatus) offlineStatus.textContent = message; };
        this.#cleanupCallbacks.push(ServiceWorkerMessenger.subscribeStatus((status) => {
            const messages: Record<string, string> = {
                disabled: t('settings.offline.status.disabled', 'Offline content is disabled.'),
                starting: t('settings.offline.status.starting', 'Preparing offline content…'),
                refreshing: t('settings.offline.status.refreshing', 'Refreshing offline content…'),
                ready: t('settings.offline.status.ready', 'Offline content is ready.'),
                error: t('settings.offline.status.error', 'Offline content could not be prepared.'),
            };
            const progress = status.totalCount ? ` ${status.cachedCount ?? 0}/${status.totalCount}` : '';
            setOfflineStatus(`${messages[status.status] ?? t('settings.offline.status', 'Offline content status unavailable.')}${progress}`);
            if (cacheDetails) {
                const timestamp = status.lastSuccessfulCacheAt ? new Date(status.lastSuccessfulCacheAt).toLocaleString() : t('settings.offline.lastUpdated.unknown', 'No successful cache yet.');
                const size = status.totalBytes ? `${(status.totalBytes / 1024).toFixed(1)} KB` : t('settings.offline.size.unknown', 'Size unavailable');
                cacheDetails.textContent = `${t('settings.offline.lastUpdated.label', 'Last successful cache')}: ${timestamp} | ${t('settings.offline.size.label', 'Cache size')}: ${size}`;
            }
            retryButton?.classList.toggle('hidden', status.status !== 'error');
        }));
        ServiceWorkerMessenger.getStatus();
        document.getElementById('refresh-cache-btn')?.addEventListener('click', () => {
            const state = this.#stateManager.getState();
            setOfflineStatus(t('settings.offline.status.starting', 'Preparing offline content…'));
            const sent = ServiceWorkerMessenger.refreshCache(state.settings.locale, state.settings.use2024Rules ? '2024' : '2014');
            if (!sent) setOfflineStatus(t('settings.storage.restricted', 'Offline content is unavailable in this browser.'));
        });
        retryButton?.addEventListener('click', () => {
            const state = this.#stateManager.getState();
            ServiceWorkerMessenger.retryCache(state.settings.locale, state.settings.use2024Rules ? '2024' : '2014');
        });
        document.getElementById('clear-cache-btn')?.addEventListener('click', () => {
            setOfflineStatus(ServiceWorkerMessenger.clearCache() ? t('settings.offline.status.clearing', 'Clearing offline content…') : t('settings.storage.restricted', 'Offline content is unavailable in this browser.'));
        });
        const connectivity = document.getElementById('connectivity-status');
        const setConnectivity = (): void => { if (connectivity) connectivity.textContent = navigator.onLine ? t('settings.offline.connectivity.online', 'Online') : t('settings.offline.connectivity.offline', 'Offline'); };
        const offline = (): void => { setConnectivity(); this.#components.viewRenderer.showNotification(t('settings.offline.notice.offline', 'You are offline. Cached content remains available.'), 'warning'); };
        const online = (): void => { setConnectivity(); this.#components.viewRenderer.showNotification(t('settings.offline.notice.online', 'You are back online. Checking for updates…'), 'info'); };
        setConnectivity();
        window.addEventListener('offline', offline);
        window.addEventListener('online', online);
        this.#cleanupCallbacks.push(() => window.removeEventListener('offline', offline), () => window.removeEventListener('online', online));
    }

    destroy(): void {
        this.#settingsTransitions.destroy();
        this.#globalInteractions.destroy();
        this.#unsubscribeStateEvents.splice(0).forEach((unsubscribe) => unsubscribe());
        this.#cleanupCallbacks.splice(0).forEach((cleanup) => cleanup());
        this.#dragDropManager?.destroy();
        this.#dragDropManager = null;
    }

    setupCollapsibleSections = (): void => {
        this.#sections.setupCollapsibleSections();
    };

    #renderSingleSection = (section: SectionConfig): void => {
        this.#sections.renderSingleSection(section);
    };

    persistAllSectionStates(): void {
        this.#sections.persistAllSectionStates();
    }

    bindGlobalEventListeners = (): void => {
        const mainArea = this.#domProvider.get(CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA);
        mainArea.addEventListener('click', this.#dataUserActions.handleItemClick);
        mainArea.addEventListener('keydown', this.#dataUserActions.handleItemKeydown);
        this.#cleanupCallbacks.push(
            () => mainArea.removeEventListener('click', this.#dataUserActions.handleItemClick),
            () => mainArea.removeEventListener('keydown', this.#dataUserActions.handleItemKeydown),
        );
        try { this.#domProvider.get(CONFIG.ELEMENT_IDS.REPORT_RULE_BTN).addEventListener('click', this.#handleReportClick); } catch { console.warn('Report rule button not found.'); }
        try {
            this.#domProvider.get(CONFIG.ELEMENT_IDS.EXPORT_NOTES_BTN).addEventListener('click', () => {
                void this.#services.userData.exportNotes().catch((e) => {
                    console.warn('Export notes failed:', e);
                    this.#components.viewRenderer.showNotification(this.#services.localization.translate('export.failed', 'Export failed. Please try again.'), 'error');
                });
            });
        } catch { console.warn('Export notes button not found.'); }
        try {
            const importBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.IMPORT_NOTES_BTN);
            const importInput = this.#domProvider.get(CONFIG.ELEMENT_IDS.IMPORT_NOTES_INPUT) as HTMLInputElement;
            importBtn.addEventListener('click', () => importInput.click());
            importBtn.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); importInput.click(); } });
            importInput.addEventListener('change', async () => {
                const file = importInput.files?.[0];
                if (!file) return;
                try {
                    const count = await this.#services.userData.importNotes(file);
                    this.#components.viewRenderer.showNotification(this.#services.localization.translate('notes.imported', 'Imported {count} note(s) successfully.', { count }), 'success');
                } catch {
                    this.#components.viewRenderer.showNotification(this.#services.localization.translate('notes.importFailed', 'Import failed. Check the file and try again.'), 'error');
                }
                importInput.value = '';
            });
        } catch { console.warn('Import notes elements not found.'); }
        try {
            this.#domProvider.get(CONFIG.ELEMENT_IDS.EXPORT_FAVORITES_BTN).addEventListener('click', () => {
                void this.#services.userData.exportFavorites().catch((e) => {
                    console.warn('Export favorites failed:', e);
                    this.#components.viewRenderer.showNotification(this.#services.localization.translate('export.failed', 'Export failed. Please try again.'), 'error');
                });
            });
        } catch { console.warn('Export favorites button not found.'); }
    };

    setupBackToTop = (): void => {
        this.#globalInteractions.setupBackToTop();
    };

    #handleReportClick = (): void => {
        const topId = this.#components.windowManager.getTopMostPopupId();
        const repoUrl = 'https://github.com/NatsumeAoii/dnd5e-quickref/issues/new';
        let issueUrl: string;
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

    async renderSectionContent(section: HTMLElement): Promise<void> {
        await this.#sections.renderSectionContent(section);
    }

    setupSettingsHandlers = (): void => {
        this.#settingsTransitions.setupHandlers();
    };

}
