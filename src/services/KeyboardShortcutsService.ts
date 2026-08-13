import { CONFIG } from '../config.js';
import { trapFocusWithin } from '../utils/Utils.js';
import type { A11yService } from './A11yService.js';
import type { LocalizationService } from './LocalizationService.js';

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
    #returnFocusEl: HTMLElement | null = null;
    #localization?: LocalizationService;

    constructor(a11yService: A11yService, localization?: LocalizationService) {
        this.#a11yService = a11yService;
        this.#localization = localization;
    }
    #t(key: string, fallback: string, variables: Record<string, string | number> = {}): string { return this.#localization?.translate(key, fallback, variables) ?? Object.entries(variables).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), fallback); }

    initialize(): void {
        document.addEventListener('keydown', this.#handleKeyDown);
    }

    destroy(): void {
        document.removeEventListener('keydown', this.#handleKeyDown);
        this.#shortcuts.length = 0;
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
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        if (target.isContentEditable) return;

        if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            this.toggle();
            return;
        }

        for (const shortcut of this.#shortcuts) {
            const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : (!e.ctrlKey && !e.metaKey);
            const altMatch = shortcut.alt ? e.altKey : !e.altKey;
            const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
            const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

            if (ctrlMatch && altMatch && shiftMatch && keyMatch) {
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
        this.#returnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.#createModal();
        this.#a11yService.announce(this.#t('shortcuts.opened', 'Keyboard shortcuts panel opened'));
    }

    close(): void {
        if (!this.#isOpen) return;
        this.#isOpen = false;
        this.#modalEl?.remove();
        this.#modalEl = null;
        if (this.#returnFocusEl?.isConnected) this.#returnFocusEl.focus();
        this.#returnFocusEl = null;
        this.#a11yService.announce(this.#t('shortcuts.closed', 'Keyboard shortcuts panel closed'));
    }

    #appendKeys(parent: HTMLElement, keys: string): void {
        keys.split('+').forEach((key, index) => {
            if (index > 0) parent.appendChild(document.createTextNode(' + '));
            const keyEl = document.createElement('kbd');
            keyEl.textContent = key.trim();
            parent.appendChild(keyEl);
        });
    }

    #createShortcutRow(entry: ShortcutEntry): HTMLElement {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        const keys = document.createElement('span');
        keys.className = 'shortcut-keys';
        this.#appendKeys(keys, entry.keys);
        const desc = document.createElement('span');
        desc.className = 'shortcut-desc';
        desc.textContent = entry.description;
        row.append(keys, desc);
        return row;
    }

    #createModal(): void {
        this.#modalEl = document.createElement('div');
        this.#modalEl.id = CONFIG.ELEMENT_IDS.SHORTCUTS_MODAL;
        this.#modalEl.className = 'shortcuts-modal-overlay';
        this.#modalEl.setAttribute('role', 'dialog');
        this.#modalEl.setAttribute('aria-modal', 'true');
        this.#modalEl.setAttribute('aria-label', this.#t('shortcuts.title', 'Keyboard shortcuts'));

        const groups = new Map<string, ShortcutEntry[]>();
        const allEntries: ShortcutEntry[] = [
            { keys: '?', description: this.#t('shortcuts.toggle', 'Toggle this shortcuts panel'), category: this.#t('shortcuts.general', 'General') },
            { keys: 'Left Right', description: this.#t('shortcuts.itemNavigation', 'Navigate between items in sections'), category: this.#t('shortcuts.general', 'General') },
            { keys: 'Up Down', description: this.#t('shortcuts.sectionNavigation', 'Navigate between sections'), category: this.#t('shortcuts.general', 'General') },
            ...this.#shortcuts.map((s) => s.entry),
        ];

        allEntries.forEach((entry) => {
            if (!groups.has(entry.category)) groups.set(entry.category, []);
            groups.get(entry.category)!.push(entry);
        });

        const modal = document.createElement('div');
        modal.className = 'shortcuts-modal';
        modal.setAttribute('tabindex', '-1');

        const header = document.createElement('div');
        header.className = 'shortcuts-modal-header';
        const title = document.createElement('h2');
        title.textContent = this.#t('shortcuts.title', 'Keyboard Shortcuts');
        const closeBtn = document.createElement('button');
        closeBtn.className = 'shortcuts-close-btn';
        closeBtn.setAttribute('aria-label', this.#t('shortcuts.close', 'Close shortcuts'));
        closeBtn.textContent = 'x';
        header.append(title, closeBtn);

        const body = document.createElement('div');
        body.className = 'shortcuts-modal-body';
        groups.forEach((entries, category) => {
            const group = document.createElement('div');
            group.className = 'shortcuts-group';
            const groupTitle = document.createElement('h3');
            groupTitle.className = 'shortcuts-group-title';
            groupTitle.textContent = category;
            const list = document.createElement('div');
            list.className = 'shortcuts-list';
            entries.forEach((entry) => list.appendChild(this.#createShortcutRow(entry)));
            group.append(groupTitle, list);
            body.appendChild(group);
        });

        modal.append(header, body);
        this.#modalEl.appendChild(modal);

        closeBtn.addEventListener('click', () => this.close());
        this.#modalEl.addEventListener('click', (e) => {
            if (e.target === this.#modalEl) this.close();
        });
        this.#modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
            trapFocusWithin(e, this.#modalEl!);
            if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
            if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.stopPropagation(); e.preventDefault(); this.close(); }
        });

        document.body.appendChild(this.#modalEl);
        modal.focus();
    }

    getShortcuts(): ShortcutEntry[] {
        return this.#shortcuts.map((s) => s.entry);
    }

    get isModalOpen(): boolean { return this.#isOpen; }
}
