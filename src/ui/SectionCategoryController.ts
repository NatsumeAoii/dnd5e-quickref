import { CONFIG } from '../config.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { A11yService } from '../services/A11yService.js';
import type { DataService } from '../services/DataService.js';
import type { NavigationService } from '../services/NavigationService.js';
import type { StateManager } from '../state/StateManager.js';
import type { ViewRenderer } from './ViewRenderer.js';
import type { LocalizationService } from '../services/LocalizationService.js';
import type { SectionConfig, RuleData } from '../types.js';
import { getRuleMapKey } from '../utils/RuleIdentity.js';

type SectionLoadState = 'loading' | 'empty' | 'invalid' | 'offline' | 'retrying' | 'ready';

interface SectionCategoryDeps {
    domProvider: DOMProvider;
    stateManager: StateManager;
    data: DataService;
    a11y: A11yService;
    navigation: NavigationService;
    viewRenderer: ViewRenderer;
    renderSingleSection: (section: SectionConfig) => void;
    localization: LocalizationService;
}

export class SectionCategoryController {
    #deps: SectionCategoryDeps;
    #ruleMapDirty = true;

    constructor(deps: SectionCategoryDeps) { this.#deps = deps; }

    markRuleMapDirty(): void { this.#ruleMapDirty = true; }
    consumeRuleMapDirty(): boolean {
        if (!this.#ruleMapDirty) return false;
        this.#ruleMapDirty = false;
        return true;
    }

    async renderOpenSections(): Promise<void> {
        const pending: Promise<void>[] = [];
        this.#deps.domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}[data-section]`).forEach((section) => {
            const id = section.getAttribute('id');
            if (id === CONFIG.ELEMENT_IDS.SECTION_FAVORITES || id === 'section-settings' || section.classList.contains(CONFIG.CSS.IS_COLLAPSED)) return;
            const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
            content?.setAttribute(CONFIG.ATTRIBUTES.RENDERED, 'false');
            content?.querySelector('.section-row')?.replaceChildren();
            pending.push(this.renderSectionContent(section as HTMLElement));
        });
        await Promise.all(pending);
    }

    setupCollapsibleSections(): void {
        const saved = this.#loadSectionStates();
        this.#deps.domProvider.queryAll(`.${CONFIG.CSS.SECTION_TITLE}`).forEach((header) => {
            const section = header.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`) as HTMLElement | null;
            if (!section || section.dataset.section === 'settings' || section.dataset.section === 'favorites') return;
            const key = section.dataset.section ?? '';
            const control = section.querySelector('.section-toggle') as HTMLElement | null;
            if (!control) return;
            const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`) as HTMLElement | null;
            if (content && !content.id && section.id) content.id = `${section.id}-content`;
            if (content?.id) control.setAttribute('aria-controls', content.id);
            if (key in saved) section.classList.toggle(CONFIG.CSS.IS_COLLAPSED, saved[key]);
            header.removeAttribute('role');
            header.removeAttribute('tabindex');
            control.setAttribute('aria-expanded', String(!section.classList.contains(CONFIG.CSS.IS_COLLAPSED)));
            control.addEventListener('click', async () => {
                const collapsed = section.classList.toggle(CONFIG.CSS.IS_COLLAPSED);
                control.setAttribute('aria-expanded', String(!collapsed));
                this.#saveSectionState(key, collapsed);
                if (!collapsed) {
                    const sectionContent = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
                    if (sectionContent?.getAttribute(CONFIG.ATTRIBUTES.RENDERED) === 'true') this.#deps.viewRenderer.filterRuleItems(sectionContent as HTMLElement);
                    else await this.renderSectionContent(section);
                }
                this.#deps.a11y.announce(this.#deps.localization.translate('sections.state', '{section} section {state}.', { section: key, state: collapsed ? 'collapsed' : 'expanded' }));
                this.#deps.navigation.invalidateFocusables();
            });
        });
    }

    persistAllSectionStates(): void {
        this.#deps.domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}[data-section]`).forEach((section) => {
            const key = (section as HTMLElement).dataset.section;
            if (key && key !== 'settings' && key !== 'favorites') this.#saveSectionState(key, section.classList.contains(CONFIG.CSS.IS_COLLAPSED));
        });
    }

    async renderSectionContent(section: HTMLElement): Promise<void> {
        const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
        if (!content || content.getAttribute(CONFIG.ATTRIBUTES.RENDERED) === 'true') return;
        const key = section.getAttribute(CONFIG.ATTRIBUTES.SECTION_KEY);
        if (!key) return;
        const isRetry = section.dataset.loadState === 'offline' || section.dataset.loadState === 'invalid';
        this.#setLoadState(section, isRetry ? 'retrying' : 'loading');
        try {
            if (key === 'environment') {
                await this.#deps.data.ensureSectionDataLoaded('environment');
                if (this.consumeRuleMapDirty()) this.#deps.data.buildRuleMap();
                (CONFIG.SECTION_CONFIG as readonly SectionConfig[]).filter((config) => config.type === 'Environment').forEach(this.#deps.renderSingleSection);
            } else {
                const dataKey = key.replace('-', '_');
                await this.#deps.data.ensureSectionDataLoaded(dataKey);
                if (this.consumeRuleMapDirty()) this.#deps.data.buildRuleMap();
                const config = CONFIG.SECTION_CONFIG.find((candidate) => candidate.dataKey === dataKey);
                if (config) this.#deps.renderSingleSection(config);
            }
            content.setAttribute(CONFIG.ATTRIBUTES.RENDERED, 'true');
            const hasItems = Boolean(content.querySelector(`.${CONFIG.CSS.ITEM_CLASS}`));
            this.#setLoadState(section, hasItems ? 'ready' : 'empty');
        } catch (error) {
            this.#setLoadState(section, this.#isOfflineError(error) ? 'offline' : 'invalid');
            this.#deps.viewRenderer.showNotification(
                this.#deps.localization.translate(
                    this.#isOfflineError(error) ? 'sections.recovery.offline' : 'sections.recovery.invalid',
                    this.#isOfflineError(error) ? 'This category is unavailable offline. Retry when you are online.' : 'This category could not be loaded. Retry to try again.',
                ),
                'warning',
            );
        }
    }

    #isOfflineError(error: unknown): boolean {
        return !navigator.onLine || (error instanceof TypeError && /offline|network|fetch/i.test(error.message));
    }

    #setLoadState(section: HTMLElement, state: SectionLoadState): void {
        section.dataset.loadState = state;
        const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
        if (!content) return;
        content.querySelector('[data-section-state]')?.remove();
        content.querySelector('[data-section-retry]')?.remove();
        if (state === 'ready') return;
        const stateEl = document.createElement('p');
        stateEl.dataset.sectionState = state;
        stateEl.className = 'section-load-state';
        stateEl.setAttribute('role', state === 'invalid' || state === 'offline' ? 'alert' : 'status');
        stateEl.textContent = this.#stateMessage(state);
        content.prepend(stateEl);
        if (state === 'offline' || state === 'invalid') {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.dataset.sectionRetry = 'true';
            retry.className = 'section-retry-btn';
            retry.textContent = this.#deps.localization.translate('sections.retry', 'Retry category');
            retry.addEventListener('click', () => { void this.renderSectionContent(section); });
            content.prepend(retry);
        }
    }

    #stateMessage(state: SectionLoadState): string {
        const messages: Record<SectionLoadState, string> = {
            loading: 'Loading category…', empty: 'No rules are available in this category.', invalid: 'Category data is invalid.', offline: 'Category unavailable offline.', retrying: 'Retrying category…', ready: '',
        };
        return this.#deps.localization.translate(`sections.state.${state}`, messages[state]);
    }

    renderSingleSection(section: SectionConfig): void {
        const state = this.#deps.stateManager.getState();
        const sourceKey = this.#deps.data.getDataSourceKey(section.dataKey);
        const ruleset: '2014' | '2024' = state.settings.use2024Rules ? '2024' : '2014';
        const source = state.data.rulesets[ruleset][sourceKey];
        if (!Array.isArray(source)) return;
        const rules = section.dataKey.startsWith('environment_') ? source.filter((rule: RuleData) => rule.tags?.includes(section.dataKey)) : source;
        try {
            this.#deps.viewRenderer.renderSection(section.id, rules.map((rule: RuleData) => ({
                popupId: getRuleMapKey(rule, section.type),
                ruleInfo: { ruleData: rule, type: section.type, sectionId: section.id, categoryId: section.dataKey, ruleset },
            })));
        } catch (error) { console.error(`Failed to render section "${section.id}":`, error); }
    }

    #loadSectionStates(): Record<string, boolean> {
        try {
            const parsed = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SECTION_STATES) ?? '{}') as unknown;
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')) : {};
        } catch { return {}; }
    }
    #saveSectionState(key: string, collapsed: boolean): void {
        try { const states = this.#loadSectionStates(); states[key] = collapsed; localStorage.setItem(CONFIG.STORAGE_KEYS.SECTION_STATES, JSON.stringify(states)); }
        catch (error) { console.warn('Could not persist section state:', error); }
    }
}
