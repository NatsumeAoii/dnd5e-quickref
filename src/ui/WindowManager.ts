import { CONFIG } from '../config.js';
import { debounce, prefersReducedMotion } from '../utils/Utils.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { A11yService } from '../services/A11yService.js';
import type { PersistenceService } from '../services/PersistenceService.js';
import type { DataService } from '../services/DataService.js';
import type { StateManager } from '../state/StateManager.js';
import type { PopupFactory } from './PopupFactory.js';
import { PopupLinkifier } from './PopupLinkifier.js';
import type { PopupState, RuleInfo } from '../types.js';

interface WindowManagerServices {
    domProvider: DOMProvider;
    stateManager: StateManager;
    persistence: PersistenceService;
    a11y: A11yService;
    popupFactory: PopupFactory;
    data: DataService;
}

export class WindowManager {
    #domProvider: DOMProvider;
    #stateManager: StateManager;
    #persistenceService: PersistenceService;
    #a11yService: A11yService;
    #popupFactory: PopupFactory;
    #dataService: DataService;
    #popupContainer!: HTMLElement;
    #closeAllBtn!: HTMLElement;
    #isMobileView = false;
    #linkifier: PopupLinkifier;
    #inflightPopups = new Set<string>();
    static #MAX_HASH_POPUPS = 10;
    static #MAX_POPUP_ID_LENGTH = 200;

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
        this.#dataService = services.data;
        this.#popupContainer = this.#domProvider.get(CONFIG.ELEMENT_IDS.POPUP_CONTAINER);
        this.#closeAllBtn = this.#domProvider.get(CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN);
        this.#ensureMinimizedBar();
        this.#linkifier = new PopupLinkifier(this.#stateManager, this.#toShortId);
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
        if (!type) return shortId;
        try {
            return `${type}::${decodeURIComponent(encodedTitle)}`;
        } catch {
            console.warn(`Failed to decode URL component: "${encodedTitle}"`);
            return shortId;
        }
    };

    #isValidPopupId(id: string): boolean {
        return id.length > 0 &&
            id.length <= WindowManager.#MAX_POPUP_ID_LENGTH &&
            id.includes('::') &&
            !/[<>"`]/.test(id);
    }

    // #9: Scope link state queries to popup container — rule-links only exist there
    #updateAllLinkStates(): void {
        const openIds = new Set(this.#stateManager.getState().ui.openPopups.keys());
        this.#popupContainer.querySelectorAll('a.rule-link').forEach((link) => {
            const id = (link as HTMLElement).dataset.popupId;
            if (!id) return;
            const isOpen = openIds.has(id);
            link.classList.toggle(CONFIG.CSS.LINK_DISABLED, isOpen);
            if (isOpen) {
                link.removeAttribute('href');
                link.setAttribute('aria-disabled', 'true');
            } else {
                link.setAttribute('href', `#${this.#toShortId(id)}`);
                link.removeAttribute('aria-disabled');
            }
        });
    }

    #updateCloseBtnVisibility = (): void => { this.#closeAllBtn?.classList.toggle(CONFIG.CSS.IS_VISIBLE, this.#stateManager.getState().ui.openPopups.size > 1); };

    #getPopupIdByElement(popup: Element | null): string | undefined {
        if (!popup) return undefined;
        const entries = this.#stateManager.getState().ui.openPopups;
        for (const [id, el] of entries) {
            if (el === popup) return id;
        }
        return undefined;
    }

    #updateURLHash(): void {
        const openIds = Array.from(this.#stateManager.getState().ui.openPopups.keys());
        const hash = openIds.map(this.#toShortId).join(',');
        window.history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname + window.location.search);
    }

    // (B) Removed duplicate #updateCloseBtnVisibility call — deferred one inside setTimeout is sufficient
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
        this.#updateCloseBtnVisibility();
        this.#updateURLHash();
        setTimeout(() => {
            popup.close();
            popup.remove();
            this.#persistenceService.saveSession();
        }, CONFIG.ANIMATION_DURATION.POPUP_MS);
    };

    #handleKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape' || this.#stateManager.getState().ui.openPopups.size === 0) return;
        const topId = this.getTopMostPopupId();
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
        // #10: Use Pointer Events for touch+mouse+pen support on tablets
        const onPointerDown = (mdEvent: PointerEvent): void => {
            if (!(mdEvent.target instanceof HTMLElement) || mdEvent.target.closest(`.${CONFIG.CSS.POPUP_CLOSE_BTN}`)) return;
            mdEvent.preventDefault();
            header.setPointerCapture(mdEvent.pointerId);
            this.#bringToFront(popup);
            header.classList.add(CONFIG.CSS.IS_DRAGGING);
            const rect = popup.getBoundingClientRect();
            const offX = mdEvent.clientX - rect.left;
            const offY = mdEvent.clientY - rect.top;
            const onPointerMove = (mmEvent: PointerEvent): void => {
                const PADDING = CONFIG.LAYOUT.POPUP_VIEWPORT_PADDING_PX;
                const newLeft = Math.max(PADDING, Math.min(mmEvent.clientX - offX, window.innerWidth - popup.offsetWidth - PADDING));
                const newTop = Math.max(PADDING, Math.min(mmEvent.clientY - offY, window.innerHeight - popup.offsetHeight - PADDING));
                popup.style.left = `${newLeft}px`;
                popup.style.top = `${newTop}px`;
            };
            const onPointerUp = (): void => {
                header.classList.remove(CONFIG.CSS.IS_DRAGGING);
                header.removeEventListener('pointermove', onPointerMove);
                header.removeEventListener('pointerup', onPointerUp);
                this.#persistenceService.saveSession();
            };
            header.addEventListener('pointermove', onPointerMove);
            header.addEventListener('pointerup', onPointerUp);
        };
        header.addEventListener('pointerdown', onPointerDown);
        header.style.touchAction = 'none';
    }

    #ensureLinkerDataReady(): void {
        const state = this.#stateManager.getState();
        if (state.data.ruleLinkerRegex || state.data.ruleMap.size === 0) return;
        this.#dataService.buildLinkerData();
    }

    #createPopup(id: string, ruleInfo: RuleInfo, pos?: { top?: string; left?: string; zIndex?: string; width?: string; height?: string }): void {
        this.#ensureLinkerDataReady();
        const popup = this.#popupFactory.create(id, ruleInfo, this.#linkifier.linkify);
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
        if (document.startViewTransition && !prefersReducedMotion()) {
            const transition = document.startViewTransition(() => dialogEl.show());
            transition.finished.catch(() => { /* view transition superseded — safe to ignore */ });
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
            const popupId = this.#getPopupIdByElement((target as HTMLElement).closest(`.${CONFIG.CSS.POPUP_WINDOW}`));
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
            const popupId = this.#getPopupIdByElement(copyLinkBtn.closest(`.${CONFIG.CSS.POPUP_WINDOW}`));
            if (popupId) {
                const shortId = this.#toShortId(popupId);
                const url = `${window.location.origin}${window.location.pathname}#${shortId}`;
                navigator.clipboard.writeText(url).then(() => {
                    copyLinkBtn.classList.add('copied');
                    setTimeout(() => { copyLinkBtn.classList.remove('copied'); }, 1800);
                }).catch(() => {
                    console.warn('Clipboard write failed — likely insecure context.');
                });
            }
        }

        // Minimize button handler
        const minimizeBtn = (target as HTMLElement).closest(`.${CONFIG.CSS.POPUP_MINIMIZE_BTN}`) as HTMLElement | null;
        if (minimizeBtn) {
            const popupId = this.#getPopupIdByElement(minimizeBtn.closest(`.${CONFIG.CSS.POPUP_WINDOW}`));
            if (popupId) this.minimizePopup(popupId);
        }
    };

    #handleHashChange = (): void => {
        const state = this.#stateManager.getState();
        let idsFromHash = new Set<string>();
        const rawHash = window.location.hash.substring(1);
        let hashWasSanitized = false;

        if (rawHash) {
            const rawIds = rawHash.split(',').filter(Boolean);
            const boundedIds = rawIds.slice(0, WindowManager.#MAX_HASH_POPUPS);
            const validIds = boundedIds
                .map(this.#fromShortId)
                .filter((id) => this.#isValidPopupId(id));
            hashWasSanitized = rawIds.length !== boundedIds.length || validIds.length !== boundedIds.length;
            idsFromHash = new Set(validIds);
        }

        const openIds = new Set(state.ui.openPopups.keys());
        [...openIds].filter((id) => !idsFromHash.has(id)).forEach((id) => this.#closePopup(id));
        // #7: Batch popup opens to avoid sequential data fetches and DOM thrashing
        const toOpen = [...idsFromHash].filter((id) => !openIds.has(id));
        if (toOpen.length > 0) {
            void Promise.all(toOpen.map((id) => this.togglePopup(id)));
        }
        if (hashWasSanitized) this.#updateURLHash();
    };

    async togglePopup(id: string): Promise<void> {
        if (!this.#isValidPopupId(id)) {
            this.#updateURLHash();
            return;
        }
        const state = this.#stateManager.getState();
        if (state.ui.openPopups.has(id)) { this.#closePopup(id); return; }
        if (this.#inflightPopups.has(id)) return;

        this.#inflightPopups.add(id);
        try {
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
        } finally {
            this.#inflightPopups.delete(id);
        }
    }

    createPopupFromState(popupState: PopupState): void {
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
            width: popup.style.width,
            height: popup.style.height,
        });

        popup.close();
        popup.remove();
        state.ui.openPopups.delete(id);

        this.#updateAllLinkStates();
        if (this.#isMobileView) this.#popupContainer.classList.remove(CONFIG.CSS.POPUP_CONTAINER_MODAL_OPEN);
        document.body.style.setProperty('--is-modal-open', state.ui.openPopups.size > 0 ? '1' : '0');
        this.#renderMinimizedBar();
        this.#updateCloseBtnVisibility();
        this.#updateURLHash();
        this.#persistenceService.saveSession();
        this.#a11yService.announce(`${title} minimized`);
    }

    #renderMinimizedBar(): void {
        if (!this.#minimizedBar) return;
        const state = this.#stateManager.getState();
        this.#minimizedBar.replaceChildren();

        if (state.ui.minimizedPopups.size === 0) {
            this.#minimizedBar.classList.add(CONFIG.CSS.HIDDEN);
            return;
        }

        this.#minimizedBar.classList.remove(CONFIG.CSS.HIDDEN);
        state.ui.minimizedPopups.forEach((meta, id) => {
            const group = document.createElement('div');
            group.className = 'minimized-popup-tab-group';
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', `${meta.title} minimized popup`);

            const tab = document.createElement('button');
            tab.className = 'minimized-popup-tab';
            tab.type = 'button';
            tab.textContent = meta.title;
            tab.setAttribute('aria-label', `Restore ${meta.title}`);
            tab.addEventListener('click', () => this.restorePopup(id));

            const closeBtn = document.createElement('button');
            closeBtn.className = 'minimized-tab-close';
            closeBtn.type = 'button';
            closeBtn.textContent = '✕';
            closeBtn.setAttribute('aria-label', `Close minimized ${meta.title} popup`);
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.ui.minimizedPopups.delete(id);
                this.#renderMinimizedBar();
            });
            group.append(tab, closeBtn);
            this.#minimizedBar!.appendChild(group);
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
            this.#createPopup(id, rule, { top: meta.top, left: meta.left, zIndex: meta.zIndex, width: meta.width, height: meta.height });
        }
        this.#updateURLHash();
    }
}
