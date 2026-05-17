import { CONFIG } from '../config.js';
import { getMotionSafeScrollBehavior } from '../utils/Utils.js';
import type { KeyboardShortcutsService } from './KeyboardShortcutsService.js';
import type { OnboardingService } from './OnboardingService.js';

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ']);
const MODAL_SELECTORS = `#${CONFIG.ELEMENT_IDS.POPUP_CONTAINER}, #${CONFIG.ELEMENT_IDS.SHORTCUTS_MODAL}, #${CONFIG.ELEMENT_IDS.CHANGELOG_MODAL}, #${CONFIG.ELEMENT_IDS.README_MODAL}`;

export class NavigationService {
    #focusablesCache: HTMLElement[] = [];
    #focusablesDirty = true;
    #shortcuts: KeyboardShortcutsService;
    #onboarding: OnboardingService;

    constructor(shortcuts: KeyboardShortcutsService, onboarding: OnboardingService) {
        this.#shortcuts = shortcuts;
        this.#onboarding = onboarding;
    }

    invalidateFocusables(): void { this.#focusablesDirty = true; }

    #rebuildFocusables(): HTMLElement[] {
        this.#focusablesCache = Array.from<HTMLElement>(
            document.querySelectorAll(
                `.${CONFIG.CSS.SECTION_TITLE}[tabindex], ` +
                `.section-toggle, ` +
                `.${CONFIG.CSS.SECTION_CONTAINER}:not(.${CONFIG.CSS.IS_COLLAPSED}) .item-content, ` +
                `.${CONFIG.CSS.SECTION_CONTAINER}:not(.${CONFIG.CSS.IS_COLLAPSED}) button:not(.favorite-btn):not([disabled]), ` +
                `.${CONFIG.CSS.SECTION_CONTAINER}:not(.${CONFIG.CSS.IS_COLLAPSED}) select:not([disabled])`
            )
        ).filter((el) => el.offsetParent !== null);
        this.#focusablesDirty = false;
        return this.#focusablesCache;
    }

    initialize(): void {
        document.addEventListener('keydown', (e) => {
            const key = e.key;
            // Fast exit for irrelevant keys — before any DOM queries
            if (!NAV_KEYS.has(key)) return;

            if (this.#shortcuts.isModalOpen || this.#onboarding.isActive) return;
            const targetElement = e.target instanceof HTMLElement ? e.target : null;
            // Skip grid navigation when focus is inside popups or modal overlays
            if (e.target instanceof Element && e.target.closest(MODAL_SELECTORS)) return;
            const tag = targetElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (targetElement?.isContentEditable) return;

            const focusables = this.#focusablesDirty ? this.#rebuildFocusables() : this.#focusablesCache;

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
            const behavior = getMotionSafeScrollBehavior();
            const isSectionControl = (el: HTMLElement): boolean =>
                el.classList.contains(CONFIG.CSS.SECTION_TITLE) || el.classList.contains('section-toggle');

            if (key === 'ArrowRight' || key === 'ArrowDown') {
                if (key === 'ArrowDown') {
                    const nextSection = focusables.find((el, i) =>
                        i > currentIdx && isSectionControl(el)
                    );
                    const target = nextSection ?? focusables[0];
                    if (target) { target.focus(); target.scrollIntoView({ behavior, block: 'center' }); }
                } else {
                    const nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, focusables.length - 1);
                    const target = focusables[nextIdx];
                    if (target) { target.focus(); target.scrollIntoView({ behavior, block: 'nearest' }); }
                }
            } else {
                if (key === 'ArrowUp') {
                    const searchFrom = currentIdx < 0 ? focusables.length : currentIdx;
                    const prevSections = focusables.filter((el, i) =>
                        i < searchFrom && isSectionControl(el)
                    );
                    if (prevSections.length) {
                        const prev = prevSections[prevSections.length - 1];
                        if (prev) { prev.focus(); prev.scrollIntoView({ behavior, block: 'center' }); }
                    }
                } else {
                    const prevIdx = currentIdx <= 0 ? focusables.length - 1 : currentIdx - 1;
                    const target = focusables[prevIdx];
                    if (target) { target.focus(); target.scrollIntoView({ behavior, block: 'nearest' }); }
                }
            }
        });
    }
}
