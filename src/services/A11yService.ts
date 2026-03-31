import { CONFIG } from '../config.js';
import type { DOMProvider } from './DOMProvider.js';

export class A11yService {
    #announcerEl: HTMLElement | null = null;

    constructor(domProvider: DOMProvider) {
        try { this.#announcerEl = domProvider.get(CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER); } catch { console.warn('ARIA announcer not found.'); }
    }

    announce(message: string): void {
        if (!this.#announcerEl) return;
        // Clear first to force re-announcement when the same message is set consecutively
        this.#announcerEl.textContent = '';
        // Minimal async gap so the browser sees the empty → full transition as a content change
        requestAnimationFrame(() => { if (this.#announcerEl) this.#announcerEl.textContent = message; });
    }
}
