import { CONFIG } from '../config.js';
import type { A11yService } from './A11yService.js';

export interface ShortcutEntry {
    keys: string;
    description: string;
    category: string;
}

type ActionCallback = () => void;

interface RegisteredShortcut {
    entry: ShortcutEntry;
    action: ActionCallback;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    key: string;
}

export class KeyboardShortcutsService {
    #shortcuts: RegisteredShortcut[] = [];
    #modalEl: HTMLElement | null = null;
    #a11yService: A11yService;
    #isOpen = false;

    constructor(a11yService: A11yService) {
        this.#a11yService = a11yService;
    }

    initialize(): void {
        document.addEventListener('keydown', this.#handleKeyDown);
    }

    register(keys: string, description: string, category: string, action: ActionCallback): void {
        const parsed = this.#parseKeys(keys);
        this.#shortcuts.push({
            entry: { keys, description, category },
            action,
            ...parsed,
        });
    }

    #parseKeys(keys: string): { ctrl: boolean; alt: boolean; shift: boolean; key: string } {
        const KEY_ALIASES: Record<string, string> = { esc: 'escape', del: 'delete', ins: 'insert' };
        const parts = keys.toLowerCase().split('+').map((p) => p.trim());
        const rawKey = parts.filter((p) => !['ctrl', 'cmd', 'alt', 'shift'].includes(p))[0] || '';
        return {
            ctrl: parts.includes('ctrl') || parts.includes('cmd'),
            alt: parts.includes('alt'),
            shift: parts.includes('shift'),
            key: KEY_ALIASES[rawKey] ?? rawKey,
        };
    }

    #handleKeyDown = (e: KeyboardEvent): void => {
        // Don't trigger shortcuts when typing in inputs
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        if (target.isContentEditable) return;

        // ? key toggles shortcuts modal (Shift+/ on US keyboard, or literal ?)
        if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            this.toggle();
            return;
        }

        for (const shortcut of this.#shortcuts) {
            const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : (!e.ctrlKey && !e.metaKey);
            const altMatch = shortcut.alt ? e.altKey : !e.altKey;
            // For non-modifier keys, compare case-insensitively
            const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

            if (ctrlMatch && altMatch && keyMatch) {
                e.preventDefault();
                shortcut.action();
                return;
            }
        }
    };

    toggle(): void {
        if (this.#isOpen) { this.close(); return; }
        this.open();
    }

    open(): void {
        if (this.#isOpen) return;
        this.#isOpen = true;
        this.#createModal();
        this.#a11yService.announce('Keyboard shortcuts panel opened');
    }

    close(): void {
        if (!this.#isOpen) return;
        this.#isOpen = false;
        this.#modalEl?.remove();
        this.#modalEl = null;
        this.#a11yService.announce('Keyboard shortcuts panel closed');
    }

    #createModal(): void {
        this.#modalEl = document.createElement('div');
        this.#modalEl.id = CONFIG.ELEMENT_IDS.SHORTCUTS_MODAL;
        this.#modalEl.className = 'shortcuts-modal-overlay';
        this.#modalEl.setAttribute('role', 'dialog');
        this.#modalEl.setAttribute('aria-modal', 'true');
        this.#modalEl.setAttribute('aria-label', 'Keyboard shortcuts');

        // Group by category
        const groups = new Map<string, ShortcutEntry[]>();
        const allEntries: ShortcutEntry[] = [
            { keys: '?', description: 'Toggle this shortcuts panel', category: 'General' },
            { keys: '← →', description: 'Navigate between items in sections', category: 'General' },
            { keys: '↑ ↓', description: 'Navigate between sections', category: 'General' },
            ...this.#shortcuts.map((s) => s.entry),
        ];

        allEntries.forEach((entry) => {
            if (!groups.has(entry.category)) groups.set(entry.category, []);
            groups.get(entry.category)!.push(entry);
        });

        let html = `
            <div class="shortcuts-modal" tabindex="-1">
                <div class="shortcuts-modal-header">
                    <h2>⌨️ Keyboard Shortcuts</h2>
                    <button class="shortcuts-close-btn" aria-label="Close shortcuts">✕</button>
                </div>
                <div class="shortcuts-modal-body">`;

        groups.forEach((entries, category) => {
            html += `<div class="shortcuts-group">
                <h3 class="shortcuts-group-title">${category}</h3>
                <div class="shortcuts-list">`;

            entries.forEach((entry) => {
                const keys = entry.keys.split('+').map((k) => `<kbd>${k.trim()}</kbd>`).join(' + ');
                html += `<div class="shortcut-row">
                    <span class="shortcut-keys">${keys}</span>
                    <span class="shortcut-desc">${entry.description}</span>
                </div>`;
            });

            html += `</div></div>`;
        });

        html += `</div></div>`;
        this.#modalEl.innerHTML = html;

        // Close handlers
        this.#modalEl.querySelector('.shortcuts-close-btn')!.addEventListener('click', () => this.close());
        this.#modalEl.addEventListener('click', (e) => {
            if (e.target === this.#modalEl) this.close();
        });
        this.#modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
            if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.stopPropagation(); e.preventDefault(); this.close(); }
        });

        document.body.appendChild(this.#modalEl);
        (this.#modalEl.querySelector('.shortcuts-modal') as HTMLElement).focus();
    }

    getShortcuts(): ShortcutEntry[] {
        return this.#shortcuts.map((s) => s.entry);
    }

    get isModalOpen(): boolean { return this.#isOpen; }
}
