import { CONFIG } from '../config.js';
import { getMotionSafeScrollBehavior } from '../utils/Utils.js';
import type { DOMProvider } from '../services/DOMProvider.js';

export class GlobalInteractionController {
    #domProvider: DOMProvider;
    #cleanup: (() => void)[] = [];
    constructor(domProvider: DOMProvider) { this.#domProvider = domProvider; }

    setupBackToTop(): void {
        try {
            const button = this.#domProvider.get(CONFIG.ELEMENT_IDS.BACK_TO_TOP_BTN);
            let ticking = false;
            const scroll = (): void => {
                if (ticking) return;
                ticking = true;
                requestAnimationFrame(() => { button.classList.toggle(CONFIG.CSS.IS_VISIBLE, window.scrollY > 400); ticking = false; });
            };
            const click = (): void => window.scrollTo({ top: 0, behavior: getMotionSafeScrollBehavior() });
            window.addEventListener('scroll', scroll, { passive: true });
            button.addEventListener('click', click);
            this.#cleanup.push(() => window.removeEventListener('scroll', scroll), () => button.removeEventListener('click', click));
        } catch { console.warn('Back-to-top button not found.'); }
    }

    destroy(): void { this.#cleanup.splice(0).forEach((cleanup) => cleanup()); }
}
