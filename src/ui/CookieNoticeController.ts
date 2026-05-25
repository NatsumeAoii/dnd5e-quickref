import { CONFIG } from '../config.js';
import { ServiceWorkerMessenger } from '../services/ServiceWorkerMessenger.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { StateManager } from '../state/StateManager.js';
import type { ViewRenderer } from './ViewRenderer.js';

interface CookieNoticeDeps {
    domProvider: DOMProvider;
    stateManager: StateManager;
    viewRenderer: ViewRenderer;
}

/**
 * #17: Extracted from UIController — handles cookie consent notice display and dismissal.
 */
export class CookieNoticeController {
    #deps: CookieNoticeDeps;

    constructor(deps: CookieNoticeDeps) {
        this.#deps = deps;
    }

    initialize(): void {
        try {
            const notice = this.#deps.domProvider.get(CONFIG.ELEMENT_IDS.COOKIE_NOTICE);
            const acceptBtn = this.#deps.domProvider.get(CONFIG.ELEMENT_IDS.ACCEPT_COOKIES_BTN);
            const remindBtn = this.#deps.domProvider.get(CONFIG.ELEMENT_IDS.REMIND_COOKIES_LATER_BTN);
            let hasAccepted = false;
            let hasDismissedReminder = false;
            try {
                hasAccepted = window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true';
                hasDismissedReminder = window.sessionStorage.getItem(CONFIG.SESSION_STORAGE_KEYS.COOKIES_REMINDER_DISMISSED) === 'true';
            } catch (e) {
                console.warn('Could not read cookie notice state:', e);
            }

            if (!hasAccepted && !hasDismissedReminder) notice.style.display = 'block';

            const dismissNotice = (): void => {
                let finished = false;
                const finish = (): void => {
                    if (finished) return;
                    finished = true;
                    notice.style.display = 'none';
                    window.dispatchEvent(new CustomEvent('quickref:cookieNoticeDismissed'));
                };
                notice.classList.add(CONFIG.CSS.IS_CLOSING);
                notice.addEventListener('animationend', finish, { once: true });
                setTimeout(finish, CONFIG.ANIMATION_DURATION.POPUP_MS + 50);
            };
            acceptBtn.addEventListener('click', async () => {
                try {
                    window.localStorage.setItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED, 'true');
                } catch (e) {
                    console.warn('Could not persist cookie consent:', e);
                }
                dismissNotice();
                this.#deps.viewRenderer.showNotification('Saving content for offline access…');
                const ready = await ServiceWorkerMessenger.ensureServiceWorkerReady();
                if (ready) {
                    const { locale, use2024Rules } = this.#deps.stateManager.getState().settings;
                    ServiceWorkerMessenger.setCachingPolicy(true, locale, use2024Rules ? '2024' : '2014');
                }
            });
            remindBtn.addEventListener('click', () => {
                try {
                    window.sessionStorage.setItem(CONFIG.SESSION_STORAGE_KEYS.COOKIES_REMINDER_DISMISSED, 'true');
                } catch (e) {
                    console.warn('Could not persist cookie reminder dismissal:', e);
                }
                dismissNotice();
            });
        } catch (e) { console.warn(`Could not set up cookie notice: ${(e as Error).message}`); }
    }
}
