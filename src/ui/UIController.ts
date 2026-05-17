import { CONFIG } from '../config.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { A11yService } from '../services/A11yService.js';
import type { WakeLockService } from '../services/WakeLockService.js';
import type { SettingsService } from '../services/SettingsService.js';
import type { LocalizationService } from '../services/LocalizationService.js';
import type { UserDataService } from '../services/UserDataService.js';
import type { DataService } from '../services/DataService.js';
import type { NavigationService } from '../services/NavigationService.js';
import { ServiceWorkerMessenger } from '../services/ServiceWorkerMessenger.js';
import { debounce, getMotionSafeScrollBehavior } from '../utils/Utils.js';
import type { StateManager } from '../state/StateManager.js';
import type { ViewRenderer } from './ViewRenderer.js';
import type { WindowManager } from './WindowManager.js';
import { DragDropManager } from './DragDropManager.js';
import type { ThemeManifest, SectionConfig, RuleData } from '../types.js';

interface UIServices {
    a11y: A11yService;
    wakeLock: WakeLockService;
    settings: SettingsService;
    localization: LocalizationService;
    userData: UserDataService;
    data: DataService;
    navigation: NavigationService;
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
    #ruleMapDirty = true;
    #searchStatusEl: HTMLElement | null = null;
    #searchExpandedSections = new Set<HTMLElement>();

    constructor(domProvider: DOMProvider, stateManager: StateManager, services: UIServices, components: UIComponents) {
        this.#domProvider = domProvider;
        this.#stateManager = stateManager;
        this.#services = services;
        this.#components = components;
    }

    initialize(): void {
        this.setupEventSubscriptions();
        this.applyInitialSettings();
        this.setupSettingsHandlers();
        this.setupCookieNoticeHandler();
        this.bindGlobalEventListeners();
        this.setupBackToTop();
        this.#components.viewRenderer.updateFooterInfo();
        this.#handleShareTarget();
        this.#initDragDrop();
        this.#setupSearch();
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
        this.#stateManager.subscribe('settingChanged', this.#handleSettingChangeEvent);
        this.#stateManager.subscribe('favoritesChanged', () => {
            this.#components.viewRenderer.renderFavoritesSection();
            this.#initDragDrop();
        });
        this.#stateManager.subscribe('externalStateChange', this.#handleExternalStateChange as (data?: unknown) => void);
    }

    applyInitialSettings(): void {
        const { settings } = this.#stateManager.getState();
        this.#components.viewRenderer.applyAppearance(settings);
        this.#components.viewRenderer.applyMotionReduction(settings.reduceMotion);
        this.#services.wakeLock.setEnabled(settings.keepScreenOn);
    }

    async #switchRuleset(): Promise<void> {
        this.#components.windowManager.closeAllPopups();
        this.#ruleMapDirty = true;
        await this.#services.data.ensureAllDataLoadedForActiveRuleset();
        this.#services.data.buildRuleMap();
        this.#ruleMapDirty = false;
        this.#services.data.buildLinkerData();
        this.#components.viewRenderer.renderFavoritesSection();
        await this.renderOpenSections();
    }

    async #switchLocale(): Promise<void> {
        await this.#services.localization.loadAndApply(this.#stateManager.getState().settings.locale);
        await this.#switchRuleset();
    }

    async renderOpenSections(): Promise<void> {
        const rerenderPromises: Promise<void>[] = [];
        this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}[data-section]`).forEach((section) => {
            const sectionId = section.getAttribute('id');
            if (sectionId === CONFIG.ELEMENT_IDS.SECTION_FAVORITES || sectionId === 'section-settings') return;
            if (section.classList.contains(CONFIG.CSS.IS_COLLAPSED)) return;
            const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
            if (content) {
                content.setAttribute(CONFIG.ATTRIBUTES.RENDERED, 'false');
                const row = content.querySelector('.section-row');
                if (row) row.replaceChildren();
            }
            rerenderPromises.push(this.renderSectionContent(section as HTMLElement));
        });
        await Promise.all(rerenderPromises);
    }

    #handleSettingChangeEvent = async (data?: unknown): Promise<void> => {
        if (!data || typeof data !== 'object') return;
        const { key, value } = data as { key: string; value: boolean | string };
        this.#services.a11y.announce(`Setting updated: ${key.toLowerCase().replace('_', ' ')}.`);
        const { settings } = this.#stateManager.getState();
        if (key === 'RULES_2024') await this.#switchRuleset();
        else if (key === 'LOCALE') await this.#switchLocale();
        else if (key === 'THEME' || key === 'MODE' || key === 'DENSITY') this.#components.viewRenderer.applyAppearance(settings);
        else if (key === 'REDUCE_MOTION') this.#components.viewRenderer.applyMotionReduction(value as boolean);
        else if (key === 'WAKE_LOCK') this.#services.wakeLock.setEnabled(value as boolean);
        else this.#components.viewRenderer.filterRuleItems();
        this.#services.navigation.invalidateFocusables();
    };

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
                this.#components.viewRenderer.showNotification(`Shared content received: ${query}`);
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    };

    async loadAndPopulateThemes(): Promise<void> {
        try {
            const response = await fetch(CONFIG.THEME_CONFIG.MANIFEST);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const manifest = await response.json() as ThemeManifest;
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

                // Preload non-original theme CSS so switching is instant
                if (theme.id !== 'original') {
                    const link = document.createElement('link');
                    link.rel = 'preload';
                    link.as = 'style';
                    link.href = `${CONFIG.THEME_CONFIG.PATH}${theme.id}.css`;
                    document.head.appendChild(link);
                }
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

    #loadSectionStates(): Record<string, boolean> {
        try {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SECTION_STATES);
            if (!raw) return {};
            const parsed = JSON.parse(raw) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            return Object.fromEntries(
                Object.entries(parsed as Record<string, unknown>)
                    .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
            );
        } catch { return {}; }
    }

    #saveSectionState(sectionKey: string, collapsed: boolean): void {
        const states = this.#loadSectionStates();
        states[sectionKey] = collapsed;
        try {
            localStorage.setItem(CONFIG.STORAGE_KEYS.SECTION_STATES, JSON.stringify(states));
        } catch (e) {
            console.warn('Could not persist section state:', e);
        }
    }

    #getSectionDisclosureControl(section: Element): HTMLElement | null {
        return section.querySelector('.section-toggle') as HTMLElement | null;
    }

    setupCollapsibleSections = (): void => {
        const savedStates = this.#loadSectionStates();
        this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_TITLE}`).forEach((header) => {
            const section = header.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`);
            if (!section || (section as HTMLElement).dataset.section === 'settings' || (section as HTMLElement).dataset.section === 'favorites') return;

            const sectionKey = (section as HTMLElement).dataset.section || '';
            const control = this.#getSectionDisclosureControl(section);
            if (!control) return;
            const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`) as HTMLElement | null;
            if (content) {
                if (!content.id && section.id) content.id = `${section.id}-content`;
                if (content.id) control.setAttribute('aria-controls', content.id);
            }

            // Restore saved state
            if (sectionKey in savedStates) {
                section.classList.toggle(CONFIG.CSS.IS_COLLAPSED, savedStates[sectionKey]);
            }

            header.removeAttribute('role');
            header.removeAttribute('tabindex');
            const isExpanded = !section.classList.contains(CONFIG.CSS.IS_COLLAPSED);
            control.setAttribute('aria-expanded', String(isExpanded));
            const handler = async (): Promise<void> => {
                const collapsed = section.classList.toggle(CONFIG.CSS.IS_COLLAPSED);
                control.setAttribute('aria-expanded', String(!collapsed));
                this.#saveSectionState(sectionKey, collapsed);
                if (!collapsed) await this.renderSectionContent(section as HTMLElement);
                this.#services.a11y.announce(`${sectionKey} section ${collapsed ? 'collapsed' : 'expanded'}.`);
                this.#services.navigation.invalidateFocusables();
            };
            control.addEventListener('click', handler);
        });
    };

    persistAllSectionStates(): void {
        this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}[data-section]`).forEach((section) => {
            const key = (section as HTMLElement).dataset.section;
            if (!key || key === 'settings' || key === 'favorites') return;
            this.#saveSectionState(key, section.classList.contains(CONFIG.CSS.IS_COLLAPSED));
        });
    }

    bindGlobalEventListeners = (): void => {
        const mainArea = this.#domProvider.get(CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA);
        mainArea.addEventListener('click', this.#handleMainAreaClick);
        mainArea.addEventListener('keydown', this.#handleMainAreaKeydown);
        try { this.#domProvider.get(CONFIG.ELEMENT_IDS.REPORT_RULE_BTN).addEventListener('click', this.#handleReportClick); } catch { console.warn('Report rule button not found.'); }
        try {
            this.#domProvider.get(CONFIG.ELEMENT_IDS.EXPORT_NOTES_BTN).addEventListener('click', () => {
                void this.#services.userData.exportNotes().catch((e) => {
                    console.warn('Export notes failed:', e);
                    this.#components.viewRenderer.showNotification('Export failed. Please try again.', 'error');
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
                    this.#components.viewRenderer.showNotification(`Imported ${count} note(s) successfully.`, 'success');
                } catch (e) {
                    this.#components.viewRenderer.showNotification(`Import failed: ${(e as Error).message}`, 'error');
                }
                importInput.value = '';
            });
        } catch { console.warn('Import notes elements not found.'); }
        try {
            this.#domProvider.get(CONFIG.ELEMENT_IDS.EXPORT_FAVORITES_BTN).addEventListener('click', () => {
                void this.#services.userData.exportFavorites().catch((e) => {
                    console.warn('Export favorites failed:', e);
                    this.#components.viewRenderer.showNotification('Export failed. Please try again.', 'error');
                });
            });
        } catch { console.warn('Export favorites button not found.'); }
    };

    setupBackToTop = (): void => {
        try {
            const btn = this.#domProvider.get(CONFIG.ELEMENT_IDS.BACK_TO_TOP_BTN);
            let ticking = false;
            window.addEventListener('scroll', () => {
                if (!ticking) {
                    ticking = true;
                    requestAnimationFrame(() => {
                        btn.classList.toggle(CONFIG.CSS.IS_VISIBLE, window.scrollY > 400);
                        ticking = false;
                    });
                }
            }, { passive: true });
            btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: getMotionSafeScrollBehavior() }));
        } catch { console.warn('Back-to-top button not found.'); }
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

    #updateFavoriteButtonState(item: HTMLElement, isFavorite: boolean): void {
        const favoriteBtn = item.querySelector('.favorite-btn') as HTMLButtonElement | null;
        if (!favoriteBtn) return;
        const title = item.querySelector('.item-title')?.textContent?.trim()
            || item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID)?.split('::')[1]
            || 'rule';
        const label = `${isFavorite ? 'Remove' : 'Add'} ${title} ${isFavorite ? 'from' : 'to'} favorites`;
        favoriteBtn.classList.toggle(CONFIG.CSS.IS_FAVORITED, isFavorite);
        favoriteBtn.setAttribute('aria-pressed', String(isFavorite));
        favoriteBtn.setAttribute('aria-label', label);
        favoriteBtn.title = label;
    }

    #handleMainAreaClick = (e: Event): void => {
        const item = (e.target as HTMLElement).closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        if (!item) return;
        const id = item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID);
        if (!id) return;

        if ((e.target as HTMLElement).closest('.favorite-btn')) {
            this.#services.userData.toggleFavorite(id);
            const isFav = this.#services.userData.isFavorite(id);
            this.#domProvider.queryAll(`[${CONFIG.ATTRIBUTES.POPUP_ID}="${id}"]`).forEach((el) => {
                this.#updateFavoriteButtonState(el as HTMLElement, isFav);
            });
            this.#services.a11y.announce(`${id.split('::')[1]} ${isFav ? 'added to' : 'removed from'} favorites.`);
        } else if ((e.target as HTMLElement).closest('.item-content')) {
            this.#components.windowManager.togglePopup(id);
        }
    };

    #handleMainAreaKeydown = (e: Event): void => {
        const ke = e as KeyboardEvent;
        if (ke.key !== 'Enter' && ke.key !== ' ') return;
        const target = (ke.target as HTMLElement).closest('.item-content') as HTMLElement | null;
        if (target) { ke.preventDefault(); target.click(); }
    };

    async renderSectionContent(section: HTMLElement): Promise<void> {
        const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
        if (!content || content.getAttribute(CONFIG.ATTRIBUTES.RENDERED) === 'true') return;
        const dataSectionKey = section.getAttribute(CONFIG.ATTRIBUTES.SECTION_KEY);
        if (!dataSectionKey) return;

        if (dataSectionKey === 'environment') {
            await this.#services.data.ensureSectionDataLoaded('environment');
            // #2: Only rebuild ruleMap when data has actually changed
            if (this.#ruleMapDirty) { this.#services.data.buildRuleMap(); this.#ruleMapDirty = false; }
            (CONFIG.SECTION_CONFIG as readonly SectionConfig[]).filter((c) => c.type === 'Environment').forEach(this.#renderSingleSection);
        } else {
            const dataKey = dataSectionKey.replace('-', '_');
            await this.#services.data.ensureSectionDataLoaded(dataKey);
            if (this.#ruleMapDirty) { this.#services.data.buildRuleMap(); this.#ruleMapDirty = false; }
            const sectionConfig = CONFIG.SECTION_CONFIG.find((c) => c.dataKey === dataKey);
            if (sectionConfig) this.#renderSingleSection(sectionConfig);
        }
        content.setAttribute(CONFIG.ATTRIBUTES.RENDERED, 'true');
    }

    #renderSingleSection = (section: SectionConfig): void => {
        const state = this.#stateManager.getState();
        const srcKey = this.#services.data.getDataSourceKey(section.dataKey);
        const { use2024Rules } = state.settings;
        const rulesetKey = use2024Rules ? '2024' : '2014';
        const src = state.data.rulesets[rulesetKey][srcKey];
        if (!Array.isArray(src)) { console.warn(`Data source for "${section.dataKey}" is missing.`); return; }
        let rules = src;
        if (section.dataKey.startsWith('environment_')) rules = src.filter((d: RuleData) => d.tags?.includes(section.dataKey));
        const rulesWithIds = rules.map((rule: RuleData) => ({
            popupId: `${section.type}::${rule.title}`,
            ruleInfo: { ruleData: rule, type: section.type, sectionId: section.id },
        }));
        try { this.#components.viewRenderer.renderSection(section.id, rulesWithIds); } catch (e) { console.error(`Failed to render section "${section.id}":`, e); }
    };

    setupCookieNoticeHandler = (): void => {
        try {
            const notice = this.#domProvider.get(CONFIG.ELEMENT_IDS.COOKIE_NOTICE);
            const acceptBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.ACCEPT_COOKIES_BTN);
            const remindBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.REMIND_COOKIES_LATER_BTN);
            let hasAccepted = false;
            let hasDismissedReminder = false;
            try {
                hasAccepted = window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true';
                hasDismissedReminder = window.sessionStorage.getItem(CONFIG.SESSION_STORAGE_KEYS.COOKIES_REMINDER_DISMISSED) === 'true';
            } catch (e) {
                console.warn('Could not read cookie notice state:', e);
            }

            if (!hasAccepted && !hasDismissedReminder) notice.style.display = 'block';

            const dismissNotice = (): void => {
                let finished = false;
                const finish = (): void => {
                    if (finished) return;
                    finished = true;
                    notice.style.display = 'none';
                    window.dispatchEvent(new CustomEvent('quickref:cookieNoticeDismissed'));
                };
                notice.classList.add(CONFIG.CSS.IS_CLOSING);
                notice.addEventListener('animationend', finish, { once: true });
                setTimeout(finish, CONFIG.ANIMATION_DURATION.POPUP_MS + 50);
            };
            acceptBtn.addEventListener('click', async () => {
                try {
                    window.localStorage.setItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED, 'true');
                } catch (e) {
                    console.warn('Could not persist cookie consent:', e);
                }
                dismissNotice();
                this.#components.viewRenderer.showNotification('Saving content for offline access…');
                const ready = await ServiceWorkerMessenger.ensureServiceWorkerReady();
                if (ready) ServiceWorkerMessenger.setCachingPolicy(true);
            });
            remindBtn.addEventListener('click', () => {
                try {
                    window.sessionStorage.setItem(CONFIG.SESSION_STORAGE_KEYS.COOKIES_REMINDER_DISMISSED, 'true');
                } catch (e) {
                    console.warn('Could not persist cookie reminder dismissal:', e);
                }
                dismissNotice();
            });
        } catch (e) { console.warn(`Could not set up cookie notice: ${(e as Error).message}`); }
    };

    setupSettingsHandlers = (): void => {
        CONFIG.SETTINGS_CONFIG.forEach(({ id, key, stateProp, type }) => {
            try {
                const el = this.#domProvider.get(id);
                const { settings } = this.#stateManager.getState();
                if (type === 'checkbox' && el instanceof HTMLInputElement) {
                    el.checked = settings[stateProp] as boolean;
                    el.addEventListener('change', () => this.#services.settings.update(CONFIG.STORAGE_KEYS[key as keyof typeof CONFIG.STORAGE_KEYS], el.checked));
                } else if (type === 'select' && el instanceof HTMLSelectElement) {
                    el.value = settings[stateProp] as string;
                    el.addEventListener('change', () => this.#services.settings.update(CONFIG.STORAGE_KEYS[key as keyof typeof CONFIG.STORAGE_KEYS], el.value));
                }
            } catch (e) { console.warn(`Failed to set up setting #${id}: ${(e as Error).message}`); }
        });
    };

    #ensureSearchStatus(): HTMLElement | null {
        if (this.#searchStatusEl) return this.#searchStatusEl;
        const searchBar = document.getElementById('search-bar');
        if (!searchBar) return null;
        const status = document.createElement('div');
        status.id = CONFIG.ELEMENT_IDS.SEARCH_STATUS;
        status.className = 'search-status hidden';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        searchBar.insertAdjacentElement('afterend', status);
        this.#searchStatusEl = status;
        return status;
    }

    #setSearchStatus(message: string): void {
        const status = this.#ensureSearchStatus();
        if (!status) return;
        status.textContent = message;
        status.classList.toggle(CONFIG.CSS.HIDDEN, message.length === 0);
    }

    #ruleMatchesCurrentFilters(ruleType: string | undefined): boolean {
        const { showOptional, showHomebrew } = this.#stateManager.getState().settings;
        return (!ruleType || (ruleType !== 'Optional rule' && ruleType !== 'Homebrew rule')) ||
            (ruleType === 'Optional rule' && showOptional) ||
            (ruleType === 'Homebrew rule' && showHomebrew);
    }

    #getMatchingSearchIds(query: string): Set<string> {
        const ruleMap = this.#stateManager.getState().data.ruleMap;
        const matchingIds = new Set<string>();
        ruleMap.forEach((info, id) => {
            if (info.searchIndex?.includes(query) && this.#ruleMatchesCurrentFilters(info.ruleData.optional)) {
                matchingIds.add(id);
            }
        });
        return matchingIds;
    }

    #getSectionMatchCount(section: Element, matchingIds: Set<string>): number {
        let count = 0;
        const ruleMap = this.#stateManager.getState().data.ruleMap;
        matchingIds.forEach((id) => {
            const info = ruleMap.get(id);
            const parentSection = info ? document.getElementById(info.sectionId)?.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`) : null;
            if (parentSection === section) count++;
        });
        return count;
    }

    #applySearchToRenderedItems(section: Element, matchingIds: Set<string>): number {
        const items = section.querySelectorAll(`.${CONFIG.CSS.ITEM_CLASS}`);
        let visibleCount = 0;
        items.forEach((item) => {
            const el = item as HTMLElement;
            const popupId = el.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID) ?? '';
            const matches = matchingIds.has(popupId);
            el.style.display = matches ? '' : 'none';
            if (matches) visibleCount++;
        });
        return visibleCount;
    }

    #expandSectionForSearch(section: HTMLElement): void {
        if (!section.classList.contains(CONFIG.CSS.IS_COLLAPSED)) return;
        section.classList.remove(CONFIG.CSS.IS_COLLAPSED);
        this.#getSectionDisclosureControl(section)?.setAttribute('aria-expanded', 'true');
        this.#searchExpandedSections.add(section);
    }

    #restoreSearchExpandedSections(): void {
        this.#searchExpandedSections.forEach((section) => {
            section.classList.add(CONFIG.CSS.IS_COLLAPSED);
            this.#getSectionDisclosureControl(section)?.setAttribute('aria-expanded', 'false');
        });
        this.#searchExpandedSections.clear();
    }

    async #performSearch(input: HTMLInputElement, clearBtn: HTMLElement): Promise<void> {
        const query = input.value.trim().toLowerCase();
        clearBtn.classList.toggle(CONFIG.CSS.HIDDEN, query.length === 0);

        if (query.length === 0) {
            this.#components.viewRenderer.filterRuleItems();
            this.#restoreSearchExpandedSections();
            this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not([data-section="settings"])`).forEach((section) => {
                section.classList.remove(CONFIG.CSS.HIDDEN);
            });
            const favSection = document.querySelector(`[data-section="favorites"]`);
            if (favSection) favSection.classList.toggle(CONFIG.CSS.HIDDEN, this.#stateManager.getState().user.favorites.size === 0);
            this.#setSearchStatus('');
            this.#services.a11y.announce('Filter cleared');
            this.#services.navigation.invalidateFocusables();
            return;
        }

        const matchingIds = this.#getMatchingSearchIds(query);
        const sections = this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not([data-section="settings"])`);
        for (const section of sections) {
            const sectionKey = (section as HTMLElement).dataset.section;
            if (sectionKey === 'favorites') {
                section.classList.add(CONFIG.CSS.HIDDEN);
                continue;
            }

            const sectionMatchCount = this.#getSectionMatchCount(section, matchingIds);
            if (sectionMatchCount > 0) {
                this.#expandSectionForSearch(section as HTMLElement);
                const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
                if (content?.getAttribute(CONFIG.ATTRIBUTES.RENDERED) !== 'true') {
                    await this.renderSectionContent(section as HTMLElement);
                }
                this.#applySearchToRenderedItems(section, matchingIds);
                section.classList.remove(CONFIG.CSS.HIDDEN);
            } else {
                this.#applySearchToRenderedItems(section, matchingIds);
                section.classList.add(CONFIG.CSS.HIDDEN);
            }
        }

        const count = matchingIds.size;
        this.#setSearchStatus(count === 0 ? 'No matching rules' : `${count} matching rule${count === 1 ? '' : 's'}`);
        this.#services.a11y.announce(count === 0 ? `No results for ${query}` : `${count} results for ${query}`);
        this.#services.navigation.invalidateFocusables();
    }

    #setupSearch(): void {
        try {
            const input = this.#domProvider.get(CONFIG.ELEMENT_IDS.SEARCH_INPUT) as HTMLInputElement;
            const clearBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.SEARCH_CLEAR_BTN);

            const performFilter = debounce(() => { void this.#performSearch(input, clearBtn); }, 200);

            input.addEventListener('input', performFilter);
            clearBtn.addEventListener('click', () => {
                input.value = '';
                performFilter();
                input.focus();
            });
        } catch { console.warn('Search elements not found.'); }
    }
}
