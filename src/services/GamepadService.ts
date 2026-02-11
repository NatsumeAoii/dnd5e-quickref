import { CONFIG } from '../config.js';
import type { DOMProvider } from './DOMProvider.js';

export class GamepadService {
    #active = false;
    #domProvider: DOMProvider;
    #lastMove = 0;
    #MOVE_DELAY = 150;

    constructor(domProvider: DOMProvider) {
        this.#domProvider = domProvider;
        window.addEventListener('gamepadconnected', () => { this.#active = true; this.#poll(); });
        window.addEventListener('gamepaddisconnected', () => { this.#active = false; });
    }

    #poll = (): void => {
        if (!this.#active) return;
        const gp = navigator.getGamepads()[0];
        if (gp) {
            const now = Date.now();
            if (now - this.#lastMove > this.#MOVE_DELAY) {
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
        requestAnimationFrame(this.#poll);
    };

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
        const itemWidth = items[0].parentElement!.offsetWidth;
        const cols = Math.floor(containerWidth / itemWidth);

        if (Math.abs(x) > 0.5) { index += (x > 0 ? 1 : -1); } else if (Math.abs(y) > 0.5) { index += (y > 0 ? cols : -cols); }

        index = Math.max(0, Math.min(index, items.length - 1));
        items[index].focus();
        items[index].scrollIntoView({ block: 'nearest' });
    }
}
