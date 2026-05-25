import { CONFIG } from '../config.js';
import { getMotionSafeScrollBehavior, installPrintRestoreFallback } from '../utils/Utils.js';
import type { StateManager } from '../state/StateManager.js';
import type { KeyboardShortcutsService } from '../services/KeyboardShortcutsService.js';
import type { NavigationService } from '../services/NavigationService.js';
import type { A11yService } from '../services/A11yService.js';
import type { ErrorService } from '../services/ErrorService.js';
import type { WindowManager } from './WindowManager.js';
import type { UIController } from './UIController.js';

interface AppShortcutsDeps {
    stateManager: StateManager;
    shortcuts: KeyboardShortcutsService;
    navigation: NavigationService;
    a11y: A11yService;
    errorService: ErrorService;
    windowManager: WindowManager;
    controller: UIController;
}

/**
 * Extracted from main.ts — owns keyboard shortcut registration and print logic.
 */
export class AppShortcutsController {
    #deps: AppShortcutsDeps;
    #printInProgress = false;

    constructor(deps: AppShortcutsDeps) {
        this.#deps = deps;
    }

    register(): void {
        const s = this.#deps.shortcuts;

        s.register('Esc', 'Close topmost popup', 'Popups', () => {
            const topId = this.#deps.windowManager.getTopMostPopupId();
            if (topId) this.#deps.windowManager.togglePopup(topId);
        });

        s.register('Ctrl+E', 'Expand/collapse all sections', 'Navigation', () => {
            const sections = document.querySelectorAll(`.${CONFIG.CSS.SECTION_CONTAINER}:not([data-section="settings"]):not([data-section="favorites"])`);
            const allCollapsed = Array.from(sections).every((el) => el.classList.contains(CONFIG.CSS.IS_COLLAPSED));
            sections.forEach((el) => {
                el.classList.toggle(CONFIG.CSS.IS_COLLAPSED, !allCollapsed);
                this.#setSectionDisclosureExpanded(el, allCollapsed);
            });
            this.#deps.controller.persistAllSectionStates();
            if (allCollapsed) this.#deps.controller.renderOpenSections();
            this.#deps.navigation.invalidateFocusables();
        });

        s.register('Ctrl+P', 'Print quick reference', 'Tools', () => {
            void this.#printQuickReference();
        });

        s.register('t', 'Scroll to top', 'Navigation', () => {
            window.scrollTo({ top: 0, behavior: getMotionSafeScrollBehavior() });
        });

        s.register('Ctrl+W', 'Close all popups', 'Popups', () => {
            this.#deps.windowManager.closeAllPopups();
        });

        s.register('/', 'Focus search', 'Navigation', () => {
            const input = document.getElementById(CONFIG.ELEMENT_IDS.SEARCH_INPUT) as HTMLInputElement | null;
            if (input) { input.focus(); input.select(); }
        });
    }

    #setSectionDisclosureExpanded(section: Element, expanded: boolean): void {
        const control = section.querySelector('.section-toggle')
            ?? section.querySelector(`.${CONFIG.CSS.SECTION_TITLE}`);
        control?.setAttribute('aria-expanded', String(expanded));
    }

    async #printQuickReference(): Promise<void> {
        if (this.#printInProgress) return;
        this.#printInProgress = true;
        const expandedForPrint: HTMLElement[] = [];
        let restored = false;
        const restorePrintState = (): void => {
            if (restored) return;
            restored = true;
            document.body.classList.remove(CONFIG.CSS.PRINT_MODE);
            expandedForPrint.forEach((el) => {
                el.classList.add(CONFIG.CSS.IS_COLLAPSED);
                this.#setSectionDisclosureExpanded(el, false);
            });
            this.#deps.navigation.invalidateFocusables();
        };

        try {
            document.body.classList.add(CONFIG.CSS.PRINT_MODE);
            document.querySelectorAll(`.${CONFIG.CSS.SECTION_CONTAINER}.${CONFIG.CSS.IS_COLLAPSED}`).forEach((el) => {
                const section = el as HTMLElement;
                expandedForPrint.push(section);
                section.classList.remove(CONFIG.CSS.IS_COLLAPSED);
                this.#setSectionDisclosureExpanded(section, true);
            });
            await this.#deps.controller.renderOpenSections();
            this.#deps.navigation.invalidateFocusables();
            this.#deps.a11y.announce('Print view ready');
            installPrintRestoreFallback(
                restorePrintState,
                CONFIG.ANIMATION_DURATION.SECTION_TRANSITION_MS * 4,
            );
            window.print();
        } catch (error) {
            restorePrintState();
            this.#deps.errorService.warn(error instanceof Error ? error.message : String(error), 'Print');
        } finally {
            this.#printInProgress = false;
        }
    }
}
