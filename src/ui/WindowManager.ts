import { CONFIG } from '../config.js';
import { safeHTML, debounce } from '../utils/Utils.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { A11yService } from '../services/A11yService.js';
import type { PersistenceService } from '../services/PersistenceService.js';
import type { DataService } from '../services/DataService.js';
import type { StateManager } from '../state/StateManager.js';
import type { PopupFactory } from './PopupFactory.js';
import type { ViewRenderer } from './ViewRenderer.js';

interface WindowManagerServices {
    domProvider: DOMProvider;
    stateManager: StateManager;
    persistence: PersistenceService;
    a11y: A11yService;
    popupFactory: PopupFactory;
    viewRenderer: ViewRenderer;
    data: DataService;
}

export class WindowManager {
    #domProvider: DOMProvider;
    #stateManager: StateManager;
    #persistenceService: PersistenceService;
    #a11yService: A11yService;
    #popupFactory: PopupFactory;
    #viewRenderer: ViewRenderer;
    #dataService: DataService;
    #popupContainer!: HTMLElement;
    #closeAllBtn!: HTMLElement;
    #isMobileView = false;

    #TYPE_ENCODING: Readonly<Record<string, string>> = Object.freeze({
        Action: 'Ac', 'Bonus action': 'Ba', Condition: 'Co', Environment: 'En', Move: 'Mo', Reaction: 'Re',
    });

    #TYPE_DECODING: Readonly<Record<string, string>> = Object.freeze(
        Object.fromEntries(Object.entries(this.#TYPE_ENCODING).map(([k, v]) => [v, k])),
    );

    constructor(services: WindowManagerServices) {
        this.#domProvider = services.domProvider;
        this.#stateManager = services.stateManager;
        this.#persistenceService = services.persistence;
        this.#a11yService = services.a11y;
        this.#popupFactory = services.popupFactory;
        this.#viewRenderer = services.viewRenderer;
        this.#dataService = services.data;
        this.#popupContainer = this.#domProvider.get(CONFIG.ELEMENT_IDS.POPUP_CONTAINER);
        this.#closeAllBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN);
        this.#ensureMinimizedBar();
    }

    #minimizedBar: HTMLElement | null = null;

    #ensureMinimizedBar(): void {
        this.#minimizedBar = document.getElementById(CONFIG.ELEMENT_IDS.MINIMIZED_BAR);
        if (!this.#minimizedBar) {
            this.#minimizedBar = document.createElement('div');
            this.#minimizedBar.id = CONFIG.ELEMENT_IDS.MINIMIZED_BAR;
            this.#minimizedBar.className = 'minimized-popups-bar hidden';
            this.#minimizedBar.setAttribute('role', 'toolbar');
            this.#minimizedBar.setAttribute('aria-label', 'Minimized popups');
            document.body.appendChild(this.#minimizedBar);
        }
    }

    initialize(): void {
        this.#handleResize();
        this.#popupContainer.addEventListener('click', this.#handleContainerClick);
        this.#closeAllBtn.addEventListener('click', this.closeAllPopups);
        window.addEventListener('resize', debounce(this.#handleResize, CONFIG.DEBOUNCE_DELAY.RESIZE_MS));
        document.addEventListener('keydown', this.#handleKeyDown);
        window.addEventListener('hashchange', this.#handleHashChange);
    }

    #toShortId = (fullId: string): string => {
        if (!fullId?.includes('::')) return fullId;
        const [type, title] = fullId.split('::');
        const encodedType = this.#TYPE_ENCODING[type];
        return encodedType ? `${encodedType}-${encodeURIComponent(title)}` : fullId;
    };

    #fromShortId = (shortId: string): string => {
        if (!shortId?.includes('-')) return shortId;
        const separatorIndex = shortId.indexOf('-');
        const encodedType = shortId.substring(0, separatorIndex);
        const encodedTitle = shortId.substring(separatorIndex + 1);
        const type = this.#TYPE_DECODING[encodedType];
        return type ? `${type}::${decodeURIComponent(encodedTitle)}` : shortId;
    };

    #linkifyContent = (html: string): string => {
        const state = this.#stateManager.getState();
        if (!html || !state.data.ruleLinkerRegex) return html;

        const container = document.createElement('div');
        container.innerHTML = safeHTML(html) as string;

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        const textNodes: Text[] = [];
        let node = walker.nextNode();
        while (node !== null) {
            textNodes.push(node as Text);
            node = walker.nextNode();
        }

        textNodes.forEach((textNode) => {
            const text = textNode.nodeValue || '';
            const matches = Array.from(text.matchAll(state.data.ruleLinkerRegex!));
            if (matches.length === 0) return;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            matches.forEach((match) => {
                const matchText = match[0];
                const matchIndex = match.index!;

                if (matchIndex > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchIndex)));
                }

                const link = document.createElement('a');
                link.className = 'rule-link';
                link.textContent = matchText;
                const id = Array.from(state.data.ruleMap.keys())
                    .find((key) => key.toLowerCase().endsWith(`::${matchText.toLowerCase()}`));

                if (id) {
                    link.setAttribute(CONFIG.ATTRIBUTES.POPUP_ID, id);
                    const preload = (): void => {
                        const ruleInfo = state.data.ruleMap.get(id);
                        if (ruleInfo) {
                            const sectionConfig = CONFIG.SECTION_CONFIG.find((c) => c.id === ruleInfo.sectionId);
                            if (sectionConfig) this.#dataService.ensureSectionDataLoaded(this.#dataService.getDataSourceKey(sectionConfig.dataKey));
                        }
                    };
                    link.addEventListener('mouseenter', preload, { once: true });
                    link.addEventListener('focus', preload, { once: true });
                    fragment.appendChild(link);
                } else {
                    fragment.appendChild(document.createTextNode(matchText));
                }
                lastIndex = matchIndex + matchText.length;
            });

            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            }
            textNode.parentNode!.replaceChild(fragment, textNode);
        });

        return container.innerHTML;
    };

    #updateAllLinkStates(): void {
        const openIds = new Set(this.#stateManager.getState().ui.openPopups.keys());
        document.querySelectorAll('a.rule-link').forEach((link) => {
            const id = (link as HTMLElement).dataset.popupId;
            if (id) link.classList.toggle(CONFIG.CSS.LINK_DISABLED, openIds.has(id));
        });
    }

    #updateCloseBtnVisibility = (): void => { this.#closeAllBtn?.classList.toggle(CONFIG.CSS.IS_VISIBLE, this.#stateManager.getState().ui.openPopups.size > 1); };

    #updateURLHash(): void {
        const openIds = Array.from(this.#stateManager.getState().ui.openPopups.keys());
        const hash = openIds.map(this.#toShortId).join(',');
        window.history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname + window.location.search);
    }

    #closePopup = (id: string): void => {
        const state = this.#stateManager.getState();
        const popup = state.ui.openPopups.get(id);
        if (!popup) return;
        popup.classList.add(CONFIG.CSS.IS_CLOSING);
        state.ui.openPopups.delete(id);
        this.#a11yService.announce(`Closed popup for ${id.split('::')[1]}`);
        this.#updateAllLinkStates();
        if (this.#isMobileView) this.#popupContainer.classList.remove(CONFIG.CSS.POPUP_CONTAINER_MODAL_OPEN);
        document.body.style.setProperty('--is-modal-open', state.ui.openPopups.size > 0 ? '1' : '0');
        setTimeout(() => {
            popup.close();
            popup.remove();
            this.#updateCloseBtnVisibility();
        }, CONFIG.ANIMATION_DURATION.POPUP_MS);
        this.#persistenceService.saveSession();
        this.#updateCloseBtnVisibility();
        this.#updateURLHash();
    };

    #handleKeyDown = (e: KeyboardEvent): void => {
        const state = this.#stateManager.getState();
        if (e.key !== 'Escape' || state.ui.openPopups.size === 0) return;
        let topId: string | null = null; let maxZ = -1;
        state.ui.openPopups.forEach((el, id) => { const z = parseInt(el.style.zIndex || '0', 10); if (z > maxZ) { maxZ = z; topId = id; } });
        if (topId) this.#closePopup(topId);
    };

    #bringToFront(popup: HTMLElement): void {
        if (popup.classList.contains(CONFIG.CSS.IS_ACTIVE)) return;
        this.#popupContainer.querySelectorAll(`.${CONFIG.CSS.POPUP_WINDOW}`).forEach((w) => w.classList.remove(CONFIG.CSS.IS_ACTIVE));
        const state = this.#stateManager.getState();
        state.ui.activeZIndex++;
        popup.style.zIndex = String(state.ui.activeZIndex);
        popup.classList.add(CONFIG.CSS.IS_ACTIVE);
        this.#persistenceService.saveSession();
    }

    #makeDraggable(popup: HTMLElement): void {
        const header = popup.querySelector('.popup-header') as HTMLElement | null;
        if (!header) return;
        const onMouseDown = (mdEvent: MouseEvent): void => {
            if (!(mdEvent.target instanceof HTMLElement) || mdEvent.target.closest(`.${CONFIG.CSS.POPUP_CLOSE_BTN}`)) return;
            mdEvent.preventDefault();
            this.#bringToFront(popup);
            header.classList.add(CONFIG.CSS.IS_DRAGGING);
            const rect = popup.getBoundingClientRect();
            const offX = mdEvent.clientX - rect.left;
            const offY = mdEvent.clientY - rect.top;
            const onMouseMove = (mmEvent: MouseEvent): void => {
                const PADDING = CONFIG.LAYOUT.POPUP_VIEWPORT_PADDING_PX;
                const newLeft = Math.max(PADDING, Math.min(mmEvent.clientX - offX, window.innerWidth - popup.offsetWidth - PADDING));
                const newTop = Math.max(PADDING, Math.min(mmEvent.clientY - offY, window.innerHeight - popup.offsetHeight - PADDING));
                popup.style.left = `${newLeft}px`;
                popup.style.top = `${newTop}px`;
            };
            const onMouseUp = (): void => {
                header.classList.remove(CONFIG.CSS.IS_DRAGGING);
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                this.#persistenceService.saveSession();
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
        header.addEventListener('mousedown', onMouseDown);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    #createPopup(id: string, ruleInfo: any, pos?: { top?: string; left?: string; zIndex?: string; width?: string; height?: string }): void {
        const popup = this.#popupFactory.create(id, ruleInfo, this.#linkifyContent);
        if (this.#isMobileView) {
            popup.classList.add(CONFIG.CSS.POPUP_MODAL);
            this.#popupContainer.classList.add(CONFIG.CSS.POPUP_CONTAINER_MODAL_OPEN);
        } else {
            if (pos?.top && pos?.left) { popup.style.top = pos.top; popup.style.left = pos.left; } else {
                const offset = (this.#stateManager.getState().ui.openPopups.size % CONFIG.LAYOUT.POPUP_CASCADE_WRAP_COUNT) * CONFIG.LAYOUT.POPUP_CASCADE_OFFSET_PX;
                popup.style.top = `${50 + offset}px`; popup.style.left = `${100 + offset}px`;
            }
            popup.addEventListener('mousedown', () => this.#bringToFront(popup), true);
            this.#makeDraggable(popup);
        }
        this.#popupContainer.appendChild(popup);

        const dialogEl = popup as unknown as HTMLDialogElement;
        if (document.startViewTransition) {
            document.startViewTransition(() => dialogEl.show());
        } else {
            dialogEl.show();
        }

        // Apply resize on desktop
        if (!this.#isMobileView) {
            popup.style.resize = 'both';
            popup.style.overflow = 'hidden';
            popup.style.minWidth = `${CONFIG.LAYOUT.POPUP_MIN_WIDTH_PX}px`;
            popup.style.minHeight = `${CONFIG.LAYOUT.POPUP_MIN_HEIGHT_PX}px`;
            if (pos?.width) popup.style.width = pos.width;
            if (pos?.height) popup.style.height = pos.height;
        }

        const state = this.#stateManager.getState();
        popup.style.zIndex = pos?.zIndex || String(++state.ui.activeZIndex);
        state.ui.openPopups.set(id, dialogEl);
        document.body.style.setProperty('--is-modal-open', '1');
        this.#a11yService.announce(`Opened popup for ${ruleInfo.ruleData.title || 'Unknown'}`);
        this.#updateAllLinkStates();
        this.#updateCloseBtnVisibility();
        this.#persistenceService.saveSession();
        this.#updateURLHash();
        (popup.querySelector('.popup-content') as HTMLElement | null)?.focus();
    }

    #handleResize = (): void => { this.#isMobileView = window.innerWidth < CONFIG.LAYOUT.DESKTOP_BREAKPOINT_MIN_PX; };

    #handleContainerClick = (e: Event): void => {
        const { target } = e;
        if ((target as HTMLElement).closest(`.${CONFIG.CSS.POPUP_CLOSE_BTN}`)) {
            const popup = (target as HTMLElement).closest(`.${CONFIG.CSS.POPUP_WINDOW}`);
            const popupId = Array.from(this.#stateManager.getState().ui.openPopups.entries()).find(([, p]) => p === popup)?.[0];
            if (popupId) this.#closePopup(popupId);
        }
        const link = (target as HTMLElement).closest('a.rule-link') as HTMLElement | null;
        if (link && !link.classList.contains(CONFIG.CSS.LINK_DISABLED) && link.dataset.popupId) {
            e.preventDefault();
            this.togglePopup(link.dataset.popupId);
        }
        const toggleBtn = (target as HTMLElement).closest('.popup-toggle-details-btn');
        if (toggleBtn) {
            const popup = toggleBtn.closest('.popup-window');
            if (popup) {
                const summary = popup.querySelector('.popup-summary') as HTMLElement;
                const bullets = popup.querySelector('.popup-bullets') as HTMLElement;
                const isCurrentlyHidden = bullets.classList.contains('hidden');
                bullets.classList.toggle('hidden', !isCurrentlyHidden);
                summary.classList.toggle('hidden', isCurrentlyHidden);
                toggleBtn.textContent = isCurrentlyHidden ? 'Tell Me Less' : 'Tell Me More';
                toggleBtn.setAttribute('aria-expanded', String(isCurrentlyHidden));
            }
        }

        const copyLinkBtn = (target as HTMLElement).closest('.popup-copy-link-btn') as HTMLElement | null;
        if (copyLinkBtn) {
            const popup = copyLinkBtn.closest(`.${CONFIG.CSS.POPUP_WINDOW}`);
            const popupId = Array.from(this.#stateManager.getState().ui.openPopups.entries()).find(([, p]) => p === popup)?.[0];
            if (popupId) {
                const shortId = this.#toShortId(popupId);
                const url = `${window.location.origin}${window.location.pathname}#${shortId}`;
                navigator.clipboard.writeText(url).then(() => {
                    copyLinkBtn.classList.add('copied');
                    setTimeout(() => { copyLinkBtn.classList.remove('copied'); }, 1800);
                });
            }
        }

        // Minimize button handler
        const minimizeBtn = (target as HTMLElement).closest(`.${CONFIG.CSS.POPUP_MINIMIZE_BTN}`) as HTMLElement | null;
        if (minimizeBtn) {
            const popup = minimizeBtn.closest(`.${CONFIG.CSS.POPUP_WINDOW}`);
            const popupId = Array.from(this.#stateManager.getState().ui.openPopups.entries()).find(([, p]) => p === popup)?.[0];
            if (popupId) this.minimizePopup(popupId);
        }
    };

    #handleHashChange = (): void => {
        const state = this.#stateManager.getState();
        let idsFromHash = new Set<string>();
        const rawHash = window.location.hash.substring(1);

        if (rawHash) {
            idsFromHash = new Set(rawHash.split(',').filter(Boolean).map(this.#fromShortId));
        }

        const openIds = new Set(state.ui.openPopups.keys());
        [...openIds].filter((id) => !idsFromHash.has(id)).forEach((id) => this.#closePopup(id));
        [...idsFromHash].filter((id) => !openIds.has(id)).forEach((id) => this.togglePopup(id));
    };

    async togglePopup(id: string): Promise<void> {
        const state = this.#stateManager.getState();
        if (state.ui.openPopups.has(id)) { this.#closePopup(id); return; }

        let rule = state.data.ruleMap.get(id);
        if (!rule) {
            await this.#dataService.ensureAllDataLoadedForActiveRuleset();
            this.#dataService.buildRuleMap();
            rule = this.#stateManager.getState().data.ruleMap.get(id);
        }

        if (rule) {
            this.#createPopup(id, rule);
        } else {
            console.warn(`Rule not found: "${id}". Removing from URL hash.`);
            this.#updateURLHash();
        }
    }

    createPopupFromState(popupState: { id: string; top?: string; left?: string; zIndex?: string }): void {
        const rule = this.#stateManager.getState().data.ruleMap.get(popupState.id);
        if (rule) this.#createPopup(popupState.id, rule, popupState);
    }

    loadPopupsFromURL(): void { this.#handleHashChange(); }

    closeAllPopups = (): void => [...this.#stateManager.getState().ui.openPopups.keys()].forEach((id) => this.#closePopup(id));

    getTopMostPopupId(): string | null {
        const state = this.#stateManager.getState();
        if (state.ui.openPopups.size === 0) return null;
        let topId: string | null = null; let maxZ = -1;
        state.ui.openPopups.forEach((el, id) => { const z = parseInt(el.style.zIndex || '0', 10); if (z > maxZ) { maxZ = z; topId = id; } });
        return topId;
    }

    minimizePopup(id: string): void {
        const state = this.#stateManager.getState();
        const popup = state.ui.openPopups.get(id);
        if (!popup) return;

        const title = popup.querySelector('.popup-title')?.textContent || 'Popup';
        state.ui.minimizedPopups.set(id, {
            title,
            top: popup.style.top,
            left: popup.style.left,
            zIndex: popup.style.zIndex,
        });

        popup.close();
        popup.remove();
        state.ui.openPopups.delete(id);

        // Create minimized tab in the bar
        this.#renderMinimizedBar();
        this.#updateCloseBtnVisibility();
        this.#a11yService.announce(`${title} minimized`);
    }

    #renderMinimizedBar(): void {
        if (!this.#minimizedBar) return;
        const state = this.#stateManager.getState();
        this.#minimizedBar.innerHTML = '';

        if (state.ui.minimizedPopups.size === 0) {
            this.#minimizedBar.classList.add(CONFIG.CSS.HIDDEN);
            return;
        }

        this.#minimizedBar.classList.remove(CONFIG.CSS.HIDDEN);
        state.ui.minimizedPopups.forEach((meta, id) => {
            const tab = document.createElement('button');
            tab.className = 'minimized-popup-tab';
            tab.textContent = meta.title;
            tab.setAttribute('aria-label', `Restore ${meta.title}`);
            tab.addEventListener('click', () => this.restorePopup(id));

            const closeBtn = document.createElement('span');
            closeBtn.className = 'minimized-tab-close';
            closeBtn.textContent = '✕';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.ui.minimizedPopups.delete(id);
                this.#renderMinimizedBar();
            });
            tab.appendChild(closeBtn);
            this.#minimizedBar!.appendChild(tab);
        });
    }

    restorePopup(id: string): void {
        const state = this.#stateManager.getState();
        const meta = state.ui.minimizedPopups.get(id);
        if (!meta) return;

        state.ui.minimizedPopups.delete(id);
        this.#renderMinimizedBar();

        const rule = state.data.ruleMap.get(id);
        if (rule) {
            this.#createPopup(id, rule, { top: meta.top, left: meta.left, zIndex: meta.zIndex });
        }
    }
}
