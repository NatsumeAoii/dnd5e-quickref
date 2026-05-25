import { CONFIG } from '../config.js';
import { debounce } from '../utils/Utils.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { A11yService } from '../services/A11yService.js';
import type { DataService } from '../services/DataService.js';
import type { NavigationService } from '../services/NavigationService.js';
import type { StateManager } from '../state/StateManager.js';
import type { ViewRenderer } from './ViewRenderer.js';

interface SearchDeps {
    domProvider: DOMProvider;
    stateManager: StateManager;
    a11y: A11yService;
    data: DataService;
    navigation: NavigationService;
    viewRenderer: ViewRenderer;
    renderSectionContent: (section: HTMLElement) => Promise<void>;
}

/**
 * #17: Extracted from UIController — handles search input, filtering, and status display.
 */
export class SearchController {
    #deps: SearchDeps;
    #searchStatusEl: HTMLElement | null = null;
    #searchExpandedSections = new Set<HTMLElement>();

    constructor(deps: SearchDeps) {
        this.#deps = deps;
    }

    initialize(): void {
        try {
            const input = this.#deps.domProvider.get(CONFIG.ELEMENT_IDS.SEARCH_INPUT) as HTMLInputElement;
            const clearBtn = this.#deps.domProvider.get(CONFIG.ELEMENT_IDS.SEARCH_CLEAR_BTN);

            const performFilter = debounce(() => { void this.#performSearch(input, clearBtn); }, 200);

            input.addEventListener('input', performFilter);
            clearBtn.addEventListener('click', () => {
                input.value = '';
                performFilter();
                input.focus();
            });
        } catch { console.warn('Search elements not found.'); }
    }

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
        const { showOptional, showHomebrew } = this.#deps.stateManager.getState().settings;
        return (!ruleType || (ruleType !== 'Optional rule' && ruleType !== 'Homebrew rule')) ||
            (ruleType === 'Optional rule' && showOptional) ||
            (ruleType === 'Homebrew rule' && showHomebrew);
    }

    #getMatchingSearchIds(query: string): Set<string> {
        this.#deps.data.ensureSearchIndicesReady();
        const ruleMap = this.#deps.stateManager.getState().data.ruleMap;
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
        const ruleMap = this.#deps.stateManager.getState().data.ruleMap;
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
        const control = section.querySelector('.section-toggle') as HTMLElement | null;
        control?.setAttribute('aria-expanded', 'true');
        this.#searchExpandedSections.add(section);
    }

    #restoreSearchExpandedSections(): void {
        this.#searchExpandedSections.forEach((section) => {
            section.classList.add(CONFIG.CSS.IS_COLLAPSED);
            const control = section.querySelector('.section-toggle') as HTMLElement | null;
            control?.setAttribute('aria-expanded', 'false');
        });
        this.#searchExpandedSections.clear();
    }

    async #performSearch(input: HTMLInputElement, clearBtn: HTMLElement): Promise<void> {
        const query = input.value.trim().toLowerCase();
        clearBtn.classList.toggle(CONFIG.CSS.HIDDEN, query.length === 0);

        if (query.length === 0) {
            this.#deps.viewRenderer.filterRuleItems();
            this.#restoreSearchExpandedSections();
            this.#deps.domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not([data-section="settings"])`).forEach((section) => {
                section.classList.remove(CONFIG.CSS.HIDDEN);
            });
            const favSection = document.querySelector(`[data-section="favorites"]`);
            if (favSection) favSection.classList.toggle(CONFIG.CSS.HIDDEN, this.#deps.stateManager.getState().user.favorites.size === 0);
            this.#setSearchStatus('');
            this.#deps.a11y.announce('Filter cleared');
            this.#deps.navigation.invalidateFocusables();
            return;
        }

        const matchingIds = this.#getMatchingSearchIds(query);
        const sections = this.#deps.domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not([data-section="settings"])`);
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
                    await this.#deps.renderSectionContent(section as HTMLElement);
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
        this.#deps.a11y.announce(count === 0 ? `No results for ${query}` : `${count} results for ${query}`);
        this.#deps.navigation.invalidateFocusables();
    }
}
