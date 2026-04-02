import { CONFIG } from '../config.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { A11yService } from '../services/A11yService.js';
import type { WakeLockService } from '../services/WakeLockService.js';
import type { SettingsService } from '../services/SettingsService.js';
import type { UserDataService } from '../services/UserDataService.js';
import type { DataService } from '../services/DataService.js';
import { ServiceWorkerMessenger } from '../services/ServiceWorkerMessenger.js';
import { debounce } from '../utils/Utils.js';
import type { StateManager } from '../state/StateManager.js';
import type { ViewRenderer } from './ViewRenderer.js';
import type { WindowManager } from './WindowManager.js';
import { DragDropManager } from './DragDropManager.js';
import type { ThemeManifest, SectionConfig, RuleData } from '../types.js';

interface UIServices {
    a11y: A11yService;
    wakeLock: WakeLockService;
    settings: SettingsService;
    userData: UserDataService;
    data: DataService;
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
        this.#dragDropManager = new DragDropManager(CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER, this.#services.userData);
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
        this.#components.windowManager.clearMinimized();
        // Clear active search to prevent stale matchingIds from the previous ruleset
        this.#clearSearchInput();
        this.#ruleMapDirty = true;
        await this.#services.data.ensureAllDataLoadedForActiveRuleset();
        this.#services.data.buildRuleMap();
        this.#ruleMapDirty = false;
        this.#services.data.buildLinkerData();
        this.#components.viewRenderer.renderFavoritesSection();
        await this.renderOpenSections();
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
        this.#services.a11y.announce(`Setting updated: ${key.toLowerCase().replaceAll('_', ' ')}.`);
        const { settings } = this.#stateManager.getState();
        if (key === 'RULES_2024') await this.#switchRuleset();
        else if (key === 'THEME' || key === 'MODE' || key === 'DENSITY') this.#components.viewRenderer.applyAppearance(settings);
        else if (key === 'REDUCE_MOTION') this.#components.viewRenderer.applyMotionReduction(value as boolean);
        else if (key === 'WAKE_LOCK') this.#services.wakeLock.setEnabled(value as boolean);
        else this.#components.viewRenderer.filterRuleItems();
    };

    #handleExternalStateChange = ({ type, payload }: { type: string; payload: Record<string, unknown> }): void => {
        if (type === 'SETTING_CHANGE') {
            // M3: Validate payload key against known settings whitelist
            const validKeys = CONFIG.SETTINGS_CONFIG.map((c) => c.key);
            if (typeof payload.key !== 'string' || !validKeys.includes(payload.key)) return;
            this.#services.settings.update(CONFIG.STORAGE_KEYS[payload.key as keyof typeof CONFIG.STORAGE_KEYS], payload.value as boolean | string, false);
            const config = CONFIG.SETTINGS_CONFIG.find((c) => c.key === payload.key);
            if (config) {
                try {
                    const el = this.#domProvider.get(config.id);
                    if ((el as HTMLInputElement).type === 'checkbox') (el as HTMLInputElement).checked = payload.value as boolean;
                    else (el as HTMLSelectElement).value = payload.value as string;
                } catch { /* DOM element may not exist yet */ }
            }
        } else if (type === 'FAVORITE_TOGGLE') {
            this.#services.userData.toggleFavorite(payload.id as string, false);
        } else if (type === 'NOTE_UPDATE') {
            this.#services.userData.saveNote(payload.id as string, payload.text as string, false);
        }
    };

    #handleShareTarget = (): void => {
        const params = new URLSearchParams(window.location.search);
        const title = params.get('title');
        const text = params.get('text');
        if (title || text) {
            // M1: Truncate external share content to prevent layout overflow
            const query = (text || title || '').trim().substring(0, 200);
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
            selectEl.replaceChildren();
            manifest.themes.forEach((theme) => {
                const option = document.createElement('option');
                option.value = theme.id;
                option.textContent = theme.displayName;
                selectEl.appendChild(option);

                // Prefetch non-original theme CSS so switching is near-instant
                if (theme.id !== 'original') {
                    const link = document.createElement('link');
                    link.rel = 'prefetch';
                    link.as = 'style';
                    link.href = `${CONFIG.THEME_CONFIG.PATH}${theme.id}.css`;
                    document.head.appendChild(link);
                }
            });
        } catch (e) {
            console.error('Fatal: Could not load theme manifest.', e);
            const selectFallback = this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_SELECT) as HTMLSelectElement;
            selectFallback.replaceChildren();
            const fallbackOption = document.createElement('option');
            fallbackOption.value = 'original';
            fallbackOption.textContent = 'Original';
            selectFallback.appendChild(fallbackOption);
        }
    }

    #loadSectionStates(): Record<string, boolean> {
        try {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SECTION_STATES);
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }

    #saveSectionState(sectionKey: string, collapsed: boolean): void {
        const states = this.#loadSectionStates();
        states[sectionKey] = collapsed;
        localStorage.setItem(CONFIG.STORAGE_KEYS.SECTION_STATES, JSON.stringify(states));
    }

    // Sections to expand by default for new users (no saved preferences).
    // Keeps first-load fast by capping initial DOM creation to ~30 items.
    static readonly #NEW_USER_DEFAULT_EXPANDED = new Set(['movement', 'action']);

    setupCollapsibleSections = (): void => {
        const savedStates = this.#loadSectionStates();
        const isNewUser = Object.keys(savedStates).length === 0;
        this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_TITLE}`).forEach((header) => {
            const section = header.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`);
            if (!section || (section as HTMLElement).dataset.section === 'settings' || (section as HTMLElement).dataset.section === 'favorites') return;

            const sectionKey = (section as HTMLElement).dataset.section || '';

            // Restore saved state, or apply new-user defaults
            if (sectionKey in savedStates) {
                section.classList.toggle(CONFIG.CSS.IS_COLLAPSED, savedStates[sectionKey]);
            } else if (isNewUser && !UIController.#NEW_USER_DEFAULT_EXPANDED.has(sectionKey)) {
                section.classList.add(CONFIG.CSS.IS_COLLAPSED);
            }

            header.setAttribute('role', 'button');
            header.setAttribute('tabindex', '0');
            const isExpanded = !section.classList.contains(CONFIG.CSS.IS_COLLAPSED);
            header.setAttribute('aria-expanded', String(isExpanded));
            const handler = async (): Promise<void> => {
                const collapsed = section.classList.toggle(CONFIG.CSS.IS_COLLAPSED);
                header.setAttribute('aria-expanded', String(!collapsed));
                this.#saveSectionState(sectionKey, collapsed);
                if (!collapsed) {
                    await this.renderSectionContent(section as HTMLElement);
                    // Re-apply active search filter to newly rendered items
                    this.#reapplySearchFilter();
                }
                this.#services.a11y.announce(`${sectionKey} section ${collapsed ? 'collapsed' : 'expanded'}.`);
            };
            header.addEventListener('click', handler);
            header.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); handler(); } });
        });
    };

    persistAllSectionStates(): void {
        const states = this.#loadSectionStates();
        this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}[data-section]`).forEach((section) => {
            const key = (section as HTMLElement).dataset.section;
            if (!key || key === 'settings' || key === 'favorites') return;
            states[key] = section.classList.contains(CONFIG.CSS.IS_COLLAPSED);
        });
        localStorage.setItem(CONFIG.STORAGE_KEYS.SECTION_STATES, JSON.stringify(states));
    }

    bindGlobalEventListeners = (): void => {
        const mainArea = this.#domProvider.get(CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA);
        mainArea.addEventListener('click', this.#handleMainAreaClick);
        mainArea.addEventListener('keydown', this.#handleMainAreaKeydown);
        try { this.#domProvider.get(CONFIG.ELEMENT_IDS.REPORT_RULE_BTN).addEventListener('click', this.#handleReportClick); } catch { console.warn('Report rule button not found.'); }
        try { this.#domProvider.get(CONFIG.ELEMENT_IDS.EXPORT_NOTES_BTN).addEventListener('click', () => this.#services.userData.exportNotes()); } catch { console.warn('Export notes button not found.'); }
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
        try { this.#domProvider.get(CONFIG.ELEMENT_IDS.EXPORT_FAVORITES_BTN).addEventListener('click', () => this.#services.userData.exportFavorites()); } catch { console.warn('Export favorites button not found.'); }
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
            btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
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

    #handleMainAreaClick = (e: Event): void => {
        const item = (e.target as HTMLElement).closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        if (!item) return;
        const id = item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID);
        if (!id) return;

        if ((e.target as HTMLElement).closest('.favorite-btn')) {
            this.#services.userData.toggleFavorite(id);
            const isFav = this.#services.userData.isFavorite(id);
            this.#domProvider.queryAll(`[${CONFIG.ATTRIBUTES.POPUP_ID}="${id}"]`).forEach((el) => {
                el.querySelector('.favorite-btn')?.classList.toggle(CONFIG.CSS.IS_FAVORITED, isFav);
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
            const hasAccepted = window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true';
            const hasDismissedReminder = window.sessionStorage.getItem(CONFIG.SESSION_STORAGE_KEYS.COOKIES_REMINDER_DISMISSED) === 'true';

            if (!hasAccepted && !hasDismissedReminder) notice.style.display = 'block';

            const dismissNotice = (): void => {
                notice.classList.add(CONFIG.CSS.IS_CLOSING);
                notice.addEventListener('animationend', () => { notice.style.display = 'none'; }, { once: true });
                // Fallback: guarantee hide even when animations are suppressed (e.g. motion-reduced)
                setTimeout(() => { notice.style.display = 'none'; }, CONFIG.ANIMATION_DURATION.SECTION_TRANSITION_MS);
            };
            acceptBtn.addEventListener('click', async () => {
                window.localStorage.setItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED, 'true');
                dismissNotice();
                this.#components.viewRenderer.showNotification('Saving content for offline access…');
                await ServiceWorkerMessenger.ensureServiceWorkerReady();
                ServiceWorkerMessenger.setCachingPolicy(true);
            });
            remindBtn.addEventListener('click', () => {
                window.sessionStorage.setItem(CONFIG.SESSION_STORAGE_KEYS.COOKIES_REMINDER_DISMISSED, 'true');
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

    /** Re-fires the search input event so the debounced filter re-applies to newly rendered items. */
    #reapplySearchFilter(): void {
        try {
            const input = this.#domProvider.get(CONFIG.ELEMENT_IDS.SEARCH_INPUT) as HTMLInputElement;
            if (input.value.trim().length > 0) {
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } catch { /* search input may not exist */ }
    }

    #clearSearchInput(): void {
        try {
            const input = this.#domProvider.get(CONFIG.ELEMENT_IDS.SEARCH_INPUT) as HTMLInputElement;
            const clearBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.SEARCH_CLEAR_BTN);
            if (input.value.trim().length === 0) return;
            input.value = '';
            clearBtn.classList.add(CONFIG.CSS.HIDDEN);
            this.#components.viewRenderer.filterRuleItems();
            // Unhide all rule sections so the fresh render is not masked by stale search state
            this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not([data-section="settings"])`).forEach((section) => {
                section.classList.remove(CONFIG.CSS.HIDDEN);
            });
            const favSection = document.querySelector(`[data-section="favorites"]`);
            if (favSection) favSection.classList.toggle(CONFIG.CSS.HIDDEN, this.#stateManager.getState().user.favorites.size === 0);
        } catch { /* search elements may not exist */ }
    }

    #setupSearch(): void {
        try {
            const input = this.#domProvider.get(CONFIG.ELEMENT_IDS.SEARCH_INPUT) as HTMLInputElement;
            const clearBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.SEARCH_CLEAR_BTN);

            const performFilter = debounce(() => {
                const query = input.value.trim().toLowerCase();
                clearBtn.classList.toggle(CONFIG.CSS.HIDDEN, query.length === 0);

                // When clearing: restore optional/homebrew visibility before doing anything
                if (query.length === 0) {
                    this.#components.viewRenderer.filterRuleItems();
                    // Re-show sections that were hidden by a previous search query
                    this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not([data-section="settings"]):not([data-section="favorites"])`).forEach((section) => {
                        // Only unhide if section is specifically search-hidden (has hidden class but has visible items)
                        const visibleItems = section.querySelectorAll(`.${CONFIG.CSS.ITEM_CLASS}`);
                        const anyVisible = Array.from(visibleItems).some((item) => (item as HTMLElement).style.display !== 'none');
                        if (anyVisible) section.classList.remove(CONFIG.CSS.HIDDEN);
                    });
                    const favSection = document.querySelector(`[data-section="favorites"]`);
                    if (favSection) favSection.classList.toggle(CONFIG.CSS.HIDDEN, this.#stateManager.getState().user.favorites.size === 0);
                    this.#services.a11y.announce('Filter cleared');
                    return;
                }

                // Build a set of matching popup IDs from the in-memory search index
                const ruleMap = this.#stateManager.getState().data.ruleMap;
                const { showOptional, showHomebrew } = this.#stateManager.getState().settings;
                const matchingIds = new Set<string>();
                // Track which SECTION_CONFIG ids have at least one match (for collapsed/unrendered sections)
                const matchingSectionIds = new Set<string>();
                ruleMap.forEach((info, id) => {
                    if (!info.searchIndex || !info.searchIndex.includes(query)) return;
                    const ruleType = info.ruleData.optional || '';
                    if ((ruleType === 'Optional rule' && !showOptional) || (ruleType === 'Homebrew rule' && !showHomebrew)) return;
                    matchingIds.add(id);
                    matchingSectionIds.add(info.sectionId);
                });

                const sections = this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not([data-section="settings"])`);
                sections.forEach((section) => {
                    const sectionKey = (section as HTMLElement).dataset.section;
                    if (sectionKey === 'favorites') {
                        section.classList.add(CONFIG.CSS.HIDDEN);
                        return;
                    }
                    const items = section.querySelectorAll(`.${CONFIG.CSS.ITEM_CLASS}`);

                    if (items.length > 0) {
                        // Section is rendered — filter DOM items directly
                        let visibleCount = 0;
                        items.forEach((item) => {
                            const el = item as HTMLElement;
                            const ruleType = el.getAttribute(CONFIG.ATTRIBUTES.RULE_TYPE);
                            const hiddenByRuleset = (ruleType === 'Optional rule' && !showOptional) ||
                                                    (ruleType === 'Homebrew rule' && !showHomebrew);
                            if (hiddenByRuleset) return;

                            const popupId = el.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID) ?? '';
                            const matches = matchingIds.has(popupId);
                            el.style.display = matches ? '' : 'none';
                            if (matches) visibleCount++;
                        });
                        section.classList.toggle(CONFIG.CSS.HIDDEN, items.length > 0 && visibleCount === 0);
                    } else {
                        // Section is collapsed/unrendered — check ruleMap for matches by sectionId
                        const dataKey = sectionKey === 'environment' ? sectionKey : sectionKey!.replace('-', '_');
                        const sectionConfigs = dataKey === 'environment'
                            ? (CONFIG.SECTION_CONFIG as readonly { id: string; dataKey: string; type: string }[]).filter((c) => c.type === 'Environment')
                            : (CONFIG.SECTION_CONFIG as readonly { id: string; dataKey: string; type: string }[]).filter((c) => c.dataKey === dataKey);
                        const hasMatch = sectionConfigs.some((c) => matchingSectionIds.has(c.id));
                        section.classList.toggle(CONFIG.CSS.HIDDEN, !hasMatch);
                    }
                });
                this.#services.a11y.announce(`Filtering by: ${query}`);
            }, 200);

            input.addEventListener('input', performFilter);
            clearBtn.addEventListener('click', () => {
                input.value = '';
                performFilter();
                input.focus();
            });
        } catch { console.warn('Search elements not found.'); }
    }
}
