import { CONFIG } from '../config.js';
import type { DOMProvider } from './DOMProvider.js';

export class A11yService {
    #announcerEl: HTMLElement | null = null;

    constructor(domProvider: DOMProvider) {
        try { this.#announcerEl = domProvider.get(CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER); } catch { console.warn('ARIA announcer not found.'); }
    }

    announce(message: string): void { if (this.#announcerEl) { this.#announcerEl.textContent = message; } }
}
