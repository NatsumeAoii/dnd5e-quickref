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
    #lastExecutedQuery: string | null = null;
    #pendingRafId: number | null = null;

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

    #getMatchingSearchIds(query: string): { matchingIds: Set<string>; sectionCounts: Map<Element, number> } {
        this.#deps.data.ensureSearchIndicesReady();
        const ruleMap = this.#deps.stateManager.getState().data.ruleMap;
        const matchingIds = new Set<string>();
        // Pre-compute section counts in a single pass instead of O(matchingIds × sections)
        const sectionCounts = new Map<Element, number>();
        ruleMap.forEach((info, id) => {
            if (info.searchIndex?.includes(query) && this.#ruleMatchesCurrentFilters(info.ruleData.optional)) {
                matchingIds.add(id);
                const sectionEl = document.getElementById(info.sectionId)?.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`);
                if (sectionEl) {
                    sectionCounts.set(sectionEl, (sectionCounts.get(sectionEl) ?? 0) + 1);
                }
            }
        });
        return { matchingIds, sectionCounts };
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

        // Skip recomputation when query unchanged between consecutive debounce intervals
        if (query.length >= 2 && query === this.#lastExecutedQuery) {
            return;
        }

        // Cancel any pending RAF from a previous search cycle
        if (this.#pendingRafId !== null) {
            cancelAnimationFrame(this.#pendingRafId);
            this.#pendingRafId = null;
        }

        if (query.length < 2) {
            this.#lastExecutedQuery = null;
            // Batch DOM visibility restoration into RAF to prevent layout thrashing
            this.#pendingRafId = requestAnimationFrame(() => {
                this.#pendingRafId = null;
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
            });
            return;
        }

        // Compute matching IDs and section counts in one pass (read phase)
        const { matchingIds, sectionCounts } = this.#getMatchingSearchIds(query);
        const sections = this.#deps.domProvider.queryAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not([data-section="settings"])`);

        // Ensure unrendered sections are rendered before DOM visibility writes
        for (const section of sections) {
            const sectionKey = (section as HTMLElement).dataset.section;
            if (sectionKey === 'favorites') continue;
            const sectionMatchCount = sectionCounts.get(section) ?? 0;
            if (sectionMatchCount > 0) {
                const content = section.querySelector(`.${CONFIG.CSS.SECTION_CONTENT}`);
                if (content?.getAttribute(CONFIG.ATTRIBUTES.RENDERED) !== 'true') {
                    await this.#deps.renderSectionContent(section as HTMLElement);
                }
            }
        }

        // Batch all DOM visibility writes in a single RAF callback (write phase)
        this.#pendingRafId = requestAnimationFrame(() => {
            this.#pendingRafId = null;
            for (const section of sections) {
                const sectionKey = (section as HTMLElement).dataset.section;
                if (sectionKey === 'favorites') {
                    section.classList.add(CONFIG.CSS.HIDDEN);
                    continue;
                }

                const sectionMatchCount = sectionCounts.get(section) ?? 0;
                if (sectionMatchCount > 0) {
                    this.#expandSectionForSearch(section as HTMLElement);
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
        });

        this.#lastExecutedQuery = query;
    }
}
