import { CONFIG } from '../config.js';
import type { DOMProvider } from './DOMProvider.js';

export class GamepadService {
    #active = false;
    #domProvider: DOMProvider;
    #lastMove = 0;
    #MOVE_DELAY = 150;
    #abortController = new AbortController();
    #animationFrameId: number | null = null;

    constructor(domProvider: DOMProvider) {
        this.#domProvider = domProvider;
        window.addEventListener('gamepadconnected', this.#handleConnected, { signal: this.#abortController.signal });
        window.addEventListener('gamepaddisconnected', this.#handleDisconnected, { signal: this.#abortController.signal });
    }

    #handleConnected = (): void => {
        if (this.#active) return;
        this.#active = true;
        this.#poll();
    };

    #handleDisconnected = (): void => {
        this.#stopPolling();
    };

    #stopPolling(): void {
        this.#active = false;
        if (this.#animationFrameId !== null) {
            cancelAnimationFrame(this.#animationFrameId);
            this.#animationFrameId = null;
        }
    }

    #poll = (): void => {
        if (!this.#active) return;
        const gp = navigator.getGamepads?.()[0];
        if (gp) {
            const now = Date.now();
            if (now - this.#lastMove > this.#MOVE_DELAY && gp.axes.length >= 2) {
                const x = gp.axes[0];
                const y = gp.axes[1];
                if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
                    this.#navigate(x, y);
                    this.#lastMove = now;
                }
                if (gp.buttons[0].pressed) {
                    const focused = document.activeElement as HTMLElement | null;
                    if (focused?.click) {
                        focused.click();
                        this.#lastMove = now + 200;
                    }
                }
            }
        }
        this.#animationFrameId = requestAnimationFrame(this.#poll);
    };

    destroy(): void {
        this.#stopPolling();
        this.#abortController.abort();
    }

    #navigate(x: number, y: number): void {
        const items = Array.from(this.#domProvider.queryAll(`.${CONFIG.CSS.ITEM_CLASS}:not([style*="display: none"]) .item-content`)) as HTMLElement[];
        if (items.length === 0) return;

        const current = document.activeElement;
        let index = items.indexOf(current as HTMLElement);

        if (index === -1) {
            items[0].focus();
            return;
        }

        const containerWidth = this.#domProvider.get(CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA).offsetWidth;
        const parentEl = items[0].parentElement;
        if (!parentEl) return;
        const itemWidth = parentEl.offsetWidth;
        if (itemWidth === 0) return;
        const cols = Math.floor(containerWidth / itemWidth);

        if (Math.abs(x) > 0.5) { index += (x > 0 ? 1 : -1); } else if (Math.abs(y) > 0.5) { index += (y > 0 ? cols : -cols); }

        index = Math.max(0, Math.min(index, items.length - 1));
        items[index].focus();
        items[index].scrollIntoView({ block: 'nearest' });
    }
}
