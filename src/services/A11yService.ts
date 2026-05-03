import { CONFIG } from '../config.js';
import type { DOMProvider } from './DOMProvider.js';

export class A11yService {
    #announcerEl: HTMLElement | null = null;
    #pendingFrame: number | null = null;

    constructor(domProvider: DOMProvider) {
        try { this.#announcerEl = domProvider.get(CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER); } catch { console.warn('ARIA announcer not found.'); }
    }

    announce(message: string): void {
        if (!this.#announcerEl) return;
        if (this.#pendingFrame !== null) window.cancelAnimationFrame(this.#pendingFrame);
        this.#announcerEl.textContent = '';
        this.#pendingFrame = window.requestAnimationFrame(() => {
            if (this.#announcerEl) this.#announcerEl.textContent = message;
            this.#pendingFrame = null;
        });
    }
}
