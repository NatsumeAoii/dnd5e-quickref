import { CONFIG } from '../config.js';
import type { A11yService } from './A11yService.js';

interface VersionBlock {
    heading: string;
    body: string[];
}

export class ChangelogService {
    #a11yService: A11yService;
    #modalEl: HTMLElement | null = null;
    #isOpen = false;
    #cachedVersions: VersionBlock[] | null = null;
    #showingAll = false;
    static readonly #INITIAL_COUNT = 3;

    constructor(a11yService: A11yService) {
        this.#a11yService = a11yService;
    }

    toggle(): void {
        if (this.#isOpen) { this.close(); return; }
        this.open();
    }

    async open(): Promise<void> {
        if (this.#isOpen) return;
        this.#isOpen = true;
        this.#showingAll = false;
        await this.#createModal();
        // Guard: user may have closed the dialog during the async fetch
        if (!this.#isOpen) return;
        this.#a11yService.announce('Changelog panel opened');
    }

    close(): void {
        if (!this.#isOpen) return;
        this.#isOpen = false;
        this.#modalEl?.remove();
        this.#modalEl = null;
        this.#a11yService.announce('Changelog panel closed');
    }

    get isModalOpen(): boolean { return this.#isOpen; }

    async #fetchChangelog(): Promise<VersionBlock[]> {
        if (this.#cachedVersions) return this.#cachedVersions;

        try {
            const res = await fetch(`CHANGELOG.md?v=${CONFIG.APP_VERSION}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            this.#cachedVersions = this.#parseChangelog(text);
        } catch (e) {
            console.warn('Failed to fetch CHANGELOG.md:', e);
            this.#cachedVersions = [{
                heading: 'Could not load changelog',
                body: ['Visit the project repository for the full changelog.'],
            }];
        }

        return this.#cachedVersions;
    }

    #parseChangelog(raw: string): VersionBlock[] {
        const lines = raw.split(/\r?\n/);
        const versions: VersionBlock[] = [];
        let current: VersionBlock | null = null;

        for (const line of lines) {
            // Match version headings: ## [x.y.z] - date  or  ## [Legacy] - text
            if (/^## \[/.test(line)) {
                if (current) versions.push(current);
                current = { heading: line.replace(/^## /, '').trim(), body: [] };
                continue;
            }
            // Skip top-level title, horizontal rules, and empty lines at the start of a block
            if (!current) continue;
            if (/^---\s*$/.test(line)) continue;
            if (/^# /.test(line)) continue;

            current.body.push(line);
        }
        if (current) versions.push(current);

        // Trim trailing empty lines from each block
        versions.forEach((v) => {
            while (v.body.length > 0 && v.body[v.body.length - 1].trim() === '') v.body.pop();
            while (v.body.length > 0 && v.body[0].trim() === '') v.body.shift();
        });

        return versions;
    }

    async #createModal(): Promise<void> {
        const versions = await this.#fetchChangelog();
        // Bail out if user closed the dialog while fetch was in-flight
        if (!this.#isOpen) return;

        this.#modalEl = document.createElement('div');
        this.#modalEl.id = CONFIG.ELEMENT_IDS.CHANGELOG_MODAL;
        this.#modalEl.className = 'changelog-modal-overlay';
        this.#modalEl.setAttribute('role', 'dialog');
        this.#modalEl.setAttribute('aria-modal', 'true');
        this.#modalEl.setAttribute('aria-label', 'Changelog');

        const modal = document.createElement('div');
        modal.className = 'changelog-modal';
        modal.setAttribute('tabindex', '-1');

        // Header
        const header = document.createElement('div');
        header.className = 'changelog-modal-header';

        const title = document.createElement('h2');
        title.textContent = "What's New";

        const closeBtn = document.createElement('button');
        closeBtn.className = 'changelog-close-btn';
        closeBtn.setAttribute('aria-label', 'Close changelog');
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => this.close());

        header.append(title, closeBtn);

        // Body
        const body = document.createElement('div');
        body.className = 'changelog-modal-body';

        this.#renderVersionBlocks(body, versions);

        modal.append(header, body);
        this.#modalEl.appendChild(modal);

        // Close handlers
        this.#modalEl.addEventListener('click', (e) => {
            if (e.target === this.#modalEl) this.close();
        });
        this.#modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
        });

        document.body.appendChild(this.#modalEl);
        modal.focus();
    }

    #renderVersionBlocks(container: HTMLElement, versions: VersionBlock[]): void {
        const displayCount = this.#showingAll ? versions.length : Math.min(ChangelogService.#INITIAL_COUNT, versions.length);

        container.replaceChildren();

        for (let i = 0; i < displayCount; i++) {
            container.appendChild(this.#buildVersionBlock(versions[i]));
        }

        // "Show All Versions" button
        if (!this.#showingAll && versions.length > ChangelogService.#INITIAL_COUNT) {
            const showAllBtn = document.createElement('button');
            showAllBtn.className = 'changelog-show-all-btn';
            showAllBtn.textContent = `Show All Versions (${versions.length - ChangelogService.#INITIAL_COUNT} more)`;
            showAllBtn.addEventListener('click', () => {
                this.#showingAll = true;
                this.#renderVersionBlocks(container, versions);
            });
            container.appendChild(showAllBtn);
        }
    }

    #buildVersionBlock(version: VersionBlock): HTMLElement {
        const block = document.createElement('div');
        block.className = 'changelog-version-block';

        const heading = document.createElement('h3');
        heading.className = 'changelog-version-heading';
        heading.textContent = version.heading;
        block.appendChild(heading);

        const content = document.createElement('div');
        content.className = 'changelog-version-content';

        let currentList: HTMLUListElement | null = null;

        for (const line of version.body) {
            const trimmed = line.trim();
            if (trimmed === '') {
                currentList = null;
                continue;
            }

            // Sub-sub-sub-heading: #### Title
            if (/^#{3,4} /.test(line)) {
                currentList = null;
                const sub = document.createElement('h4');
                sub.className = 'changelog-subheading';
                sub.textContent = line.replace(/^#{3,4} /, '').trim();
                content.appendChild(sub);
                continue;
            }

            // Sub-heading within version: ### Title
            if (/^### /.test(line)) {
                currentList = null;
                const sub = document.createElement('h4');
                sub.className = 'changelog-subheading changelog-subheading-major';
                sub.textContent = line.replace(/^### /, '').trim();
                content.appendChild(sub);
                continue;
            }

            // List item: - text or  - text (indented)
            if (/^\s*- /.test(line)) {
                if (!currentList) {
                    currentList = document.createElement('ul');
                    currentList.className = 'changelog-list';
                    content.appendChild(currentList);
                }
                const li = document.createElement('li');
                const text = trimmed.replace(/^- /, '');
                this.#renderFormattedText(li, text);

                // Detect indented sub-items
                if (/^ {2,}- /.test(line) || /^\t- /.test(line)) {
                    li.className = 'changelog-list-sub';
                }

                currentList.appendChild(li);
                continue;
            }

            // Plain paragraph
            currentList = null;
            const p = document.createElement('p');
            p.className = 'changelog-paragraph';
            this.#renderFormattedText(p, trimmed);
            content.appendChild(p);
        }

        block.appendChild(content);
        return block;
    }

    /**
     * Renders text with **bold** segments and `code` segments into a parent element.
     * Uses textContent/createElement for CSP safety — no innerHTML.
     */
    #renderFormattedText(parent: HTMLElement, text: string): void {
        // Split on **bold** and `code` patterns
        const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

        for (const part of parts) {
            if (part.startsWith('**') && part.endsWith('**')) {
                const strong = document.createElement('strong');
                strong.textContent = part.slice(2, -2);
                parent.appendChild(strong);
            } else if (part.startsWith('`') && part.endsWith('`')) {
                const code = document.createElement('code');
                code.textContent = part.slice(1, -1);
                parent.appendChild(code);
            } else if (part) {
                parent.appendChild(document.createTextNode(part));
            }
        }
    }
}
