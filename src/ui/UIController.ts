import { CONFIG } from '../config.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { A11yService } from '../services/A11yService.js';
import type { WakeLockService } from '../services/WakeLockService.js';
import type { SettingsService } from '../services/SettingsService.js';
import type { UserDataService } from '../services/UserDataService.js';
import type { DataService } from '../services/DataService.js';
import { ServiceWorkerMessenger } from '../services/ServiceWorkerMessenger.js';
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
    }

    setupEventSubscriptions(): void {
        this.#stateManager.subscribe('settingChanged', this.#handleSettingChangeEvent.bind(this) as (data?: unknown) => void);
        this.#stateManager.subscribe('favoritesChanged', () => {
            this.#components.viewRenderer.renderFavoritesSection();
            new DragDropManager(CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER, this.#services.userData);
        });
        this.#stateManager.subscribe('externalStateChange', this.#handleExternalStateChange.bind(this) as (data?: unknown) => void);
    }

    applyInitialSettings(): void {
        const { settings } = this.#stateManager.getState();
        this.#components.viewRenderer.applyAppearance(settings);
        this.#components.viewRenderer.applyMotionReduction(settings.reduceMotion);
        this.#services.wakeLock.setEnabled(settings.keepScreenOn);
    }

    async #switchRuleset(): Promise<void> {
        this.#components.windowManager.closeAllPopups();
        await this.#services.data.ensureAllDataLoadedForActiveRuleset();
        this.#services.data.buildRuleMap();
        this.#services.data.buildLinkerData();
        this.#components.viewRenderer.renderFavoritesSection();
        await this.renderOpenSections();
    }

    async renderOpenSections(): Promise<void> {
        const rerenderPromises: Promise<void>[] = [];
        this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}[data-section]`).forEach((section) => {
            const sectionId = section.getAttribute('id');
            if (sectionId === CONFIG.ELEMENT_IDS.SECTION_FAVORITES || sectionId === 'section-settings') return;
            const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
            if (content) {
                content.setAttribute(CONFIG.ATTRIBUTES.RENDERED, 'false');
                const row = content.querySelector('.section-row');
                if (row) row.innerHTML = '';
            }
            if (!section.classList.contains(CONFIG.CSS.IS_COLLAPSED)) rerenderPromises.push(this.renderSectionContent(section as HTMLElement));
        });
        await Promise.all(rerenderPromises);
    }

    #handleSettingChangeEvent = async ({ key, value }: { key: string; value: boolean | string }): Promise<void> => {
        this.#services.a11y.announce(`Setting updated: ${key.toLowerCase().replace('_', ' ')}.`);
        const { settings } = this.#stateManager.getState();
        if (key === 'RULES_2024') await this.#switchRuleset();
        else if (key === 'THEME' || key === 'MODE' || key === 'DENSITY') this.#components.viewRenderer.applyAppearance(settings);
        else if (key === 'REDUCE_MOTION') this.#components.viewRenderer.applyMotionReduction(value as boolean);
        else if (key === 'WAKE_LOCK') this.#services.wakeLock.setEnabled(value as boolean);
        else this.#components.viewRenderer.filterRuleItems();
    };

    #handleExternalStateChange = ({ type, payload }: { type: string; payload: Record<string, unknown> }): void => {
        if (type === 'SETTING_CHANGE') {
            this.#services.settings.update(CONFIG.STORAGE_KEYS[payload.key as keyof typeof CONFIG.STORAGE_KEYS], payload.value as boolean | string, false);
            const config = CONFIG.SETTINGS_CONFIG.find((c) => c.key === payload.key);
            if (config) {
                const el = this.#domProvider.get(config.id);
                if ((el as HTMLInputElement).type === 'checkbox') (el as HTMLInputElement).checked = payload.value as boolean;
                else (el as HTMLSelectElement).value = payload.value as string;
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
            selectEl.innerHTML = '';
            manifest.themes.forEach((theme) => {
                const option = document.createElement('option');
                option.value = theme.id;
                option.textContent = theme.displayName;
                selectEl.appendChild(option);
            });
        } catch (e) {
            console.error('Fatal: Could not load theme manifest.', e);
            (this.#domProvider.get(CONFIG.ELEMENT_IDS.THEME_SELECT) as HTMLSelectElement).innerHTML = '<option value="original">Original</option>';
        }
    }

    setupCollapsibleSections = (): void => {
        this.#domProvider.queryAll(`.${CONFIG.CSS.SECTION_TITLE}`).forEach((header) => {
            const section = header.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`);
            if (!section || (section as HTMLElement).dataset.section === 'settings' || (section as HTMLElement).dataset.section === 'favorites') return;
            header.setAttribute('role', 'button');
            header.setAttribute('tabindex', '0');
            const isExpanded = !section.classList.contains(CONFIG.CSS.IS_COLLAPSED);
            header.setAttribute('aria-expanded', String(isExpanded));
            const handler = async (): Promise<void> => {
                const collapsed = section.classList.toggle(CONFIG.CSS.IS_COLLAPSED);
                header.setAttribute('aria-expanded', String(!collapsed));
                if (!collapsed) await this.renderSectionContent(section as HTMLElement);
                this.#services.a11y.announce(`${(section as HTMLElement).dataset.section} section ${collapsed ? 'collapsed' : 'expanded'}.`);
            };
            header.addEventListener('click', handler);
            header.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); handler(); } });
        });
    };

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
    };

    setupBackToTop = (): void => {
        try {
            const btn = this.#domProvider.get(CONFIG.ELEMENT_IDS.BACK_TO_TOP_BTN);
            window.addEventListener('scroll', () => {
                btn.classList.toggle(CONFIG.CSS.IS_VISIBLE, window.scrollY > 400);
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

        if (dataSectionKey === 'environment') {
            await this.#services.data.ensureSectionDataLoaded('environment');
            this.#services.data.buildRuleMap();
            (CONFIG.SECTION_CONFIG as readonly SectionConfig[]).filter((c) => c.type === 'Environment').forEach(this.#renderSingleSection);
        } else {
            const dataKey = dataSectionKey!.replace('-', '_');
            await this.#services.data.ensureSectionDataLoaded(dataKey);
            this.#services.data.buildRuleMap();
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
}
