import { CONFIG } from '../config.js';
import { trapFocusWithin } from '../utils/Utils.js';
import type { A11yService } from './A11yService.js';

interface ReadmeSection {
    heading: string;
    level: number;
    body: string[];
}

export class ReadmeService {
    #a11yService: A11yService;
    #modalEl: HTMLElement | null = null;
    #isOpen = false;
    #cachedSections: ReadmeSection[] | null = null;
    #returnFocusEl: HTMLElement | null = null;

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
        this.#returnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        await this.#createModal();
        if (!this.#isOpen) return;
        this.#a11yService.announce('README panel opened');
    }

    close(): void {
        if (!this.#isOpen) return;
        this.#isOpen = false;
        this.#modalEl?.remove();
        this.#modalEl = null;
        if (this.#returnFocusEl?.isConnected) this.#returnFocusEl.focus();
        this.#returnFocusEl = null;
        this.#a11yService.announce('README panel closed');
    }

    get isModalOpen(): boolean { return this.#isOpen; }

    async #fetchReadme(): Promise<ReadmeSection[]> {
        if (this.#cachedSections) return this.#cachedSections;

        try {
            const res = await fetch(`README.md?v=${CONFIG.APP_VERSION}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            this.#cachedSections = this.#parseReadme(text);
        } catch (e) {
            console.warn('Failed to fetch README.md:', e);
            this.#cachedSections = [{
                heading: 'Could not load README',
                level: 1,
                body: ['Visit the project repository for the full documentation.'],
            }];
        }

        return this.#cachedSections;
    }

    #parseReadme(raw: string): ReadmeSection[] {
        const lines = raw.split(/\r?\n/);
        const sections: ReadmeSection[] = [];
        let current: ReadmeSection | null = null;

        for (const line of lines) {
            const headingMatch = line.match(/^(#{1,4}) (.+)/);
            if (headingMatch) {
                if (current) sections.push(current);
                current = {
                    heading: headingMatch[2].trim(),
                    level: headingMatch[1].length,
                    body: [],
                };
                continue;
            }
            if (!current) continue;
            // Skip top-level horizontal rules
            if (/^---\s*$/.test(line)) continue;
            current.body.push(line);
        }
        if (current) sections.push(current);

        // Trim trailing/leading empty lines from each block
        sections.forEach((s) => {
            while (s.body.length > 0 && s.body[s.body.length - 1].trim() === '') s.body.pop();
            while (s.body.length > 0 && s.body[0].trim() === '') s.body.shift();
        });

        return sections;
    }

    async #createModal(): Promise<void> {
        const sections = await this.#fetchReadme();
        if (!this.#isOpen) return;

        this.#modalEl = document.createElement('div');
        this.#modalEl.id = CONFIG.ELEMENT_IDS.README_MODAL;
        this.#modalEl.className = 'readme-modal-overlay';
        this.#modalEl.setAttribute('role', 'dialog');
        this.#modalEl.setAttribute('aria-modal', 'true');
        this.#modalEl.setAttribute('aria-label', 'README');

        const modal = document.createElement('div');
        modal.className = 'readme-modal';
        modal.setAttribute('tabindex', '-1');

        // Header
        const header = document.createElement('div');
        header.className = 'readme-modal-header';

        const title = document.createElement('h2');
        title.textContent = 'About This Project';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'readme-close-btn';
        closeBtn.setAttribute('aria-label', 'Close README');
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => this.close());

        header.append(title, closeBtn);

        // Body
        const body = document.createElement('div');
        body.className = 'readme-modal-body';

        this.#renderSections(body, sections);

        modal.append(header, body);
        this.#modalEl.appendChild(modal);

        // Close handlers
        this.#modalEl.addEventListener('click', (e) => {
            if (e.target === this.#modalEl) this.close();
        });
        this.#modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
            trapFocusWithin(e, this.#modalEl!);
            if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
        });

        document.body.appendChild(this.#modalEl);
        modal.focus();
    }

    #renderSections(container: HTMLElement, sections: ReadmeSection[]): void {
        for (const section of sections) {
            container.appendChild(this.#buildSection(section));
        }
    }

    #buildSection(section: ReadmeSection): HTMLElement {
        const block = document.createElement('div');
        block.className = 'readme-section-block';

        const heading = document.createElement(section.level === 1 ? 'h2' : section.level === 2 ? 'h3' : 'h4');
        heading.className = section.level <= 2 ? 'readme-section-heading' : 'readme-subheading';
        heading.textContent = section.heading;
        block.appendChild(heading);

        const content = document.createElement('div');
        content.className = 'readme-section-content';

        let currentList: HTMLUListElement | HTMLOListElement | null = null;
        let currentListType: 'ul' | 'ol' | null = null;
        let currentListItem: HTMLLIElement | null = null;
        let currentNestedList: HTMLUListElement | null = null;
        let inCodeBlock = false;
        let codeLines: string[] = [];
        let codeBlockParent: HTMLElement | null = null;
        let codeFenceIndent = '';
        let inDetailsBlock = false;
        let detailsEl: HTMLDetailsElement | null = null;
        let detailsContent: HTMLDivElement | null = null;
        let inTable = false;
        let tableRows: string[] = [];
        let tableParent: HTMLElement | null = null;

        const getTarget = (): HTMLElement => (inDetailsBlock && detailsContent ? detailsContent : content);
        const getIndent = (value: string): string => value.match(/^\s*/)?.[0] ?? '';
        const isIndented = (value: string): boolean => /^(?: {2,}|\t)/.test(value);
        const resetList = (): void => {
            currentList = null;
            currentListType = null;
            currentListItem = null;
            currentNestedList = null;
        };
        const ensureList = (type: 'ul' | 'ol'): HTMLUListElement | HTMLOListElement => {
            if (!currentList || currentListType !== type) {
                currentList = document.createElement(type);
                currentList.className = type === 'ol' ? 'readme-list readme-ordered-list' : 'readme-list';
                getTarget().appendChild(currentList);
                currentListType = type;
                currentListItem = null;
                currentNestedList = null;
            }
            return currentList;
        };
        const appendBlock = (el: HTMLElement, lineSource: string): void => {
            if (currentListItem && isIndented(lineSource)) {
                currentListItem.appendChild(el);
                return;
            }
            if (currentListItem) resetList();
            getTarget().appendChild(el);
        };
        const stripCodeIndent = (value: string): string => (
            codeFenceIndent && value.startsWith(codeFenceIndent)
                ? value.slice(codeFenceIndent.length)
                : value
        );

        for (let i = 0; i < section.body.length; i++) {
            const line = section.body[i];
            const trimmed = line.trim();

            // Code block fencing
            if (trimmed.startsWith('```')) {
                if (!inCodeBlock) {
                    inCodeBlock = true;
                    codeLines = [];
                    codeFenceIndent = getIndent(line);
                    codeBlockParent = currentListItem && isIndented(line) ? currentListItem : getTarget();
                    if (!isIndented(line) && currentListItem) resetList();
                    continue;
                }
                // End of code block
                inCodeBlock = false;
                const pre = document.createElement('pre');
                pre.className = 'readme-code-block';
                const code = document.createElement('code');
                code.textContent = codeLines.join('\n');
                pre.appendChild(code);
                (codeBlockParent ?? getTarget()).appendChild(pre);
                codeBlockParent = null;
                codeFenceIndent = '';
                continue;
            }
            if (inCodeBlock) {
                codeLines.push(stripCodeIndent(line));
                continue;
            }

            // <details> / <summary> blocks
            if (trimmed.startsWith('<details>')) {
                inDetailsBlock = true;
                detailsEl = document.createElement('details');
                detailsEl.className = 'readme-details';
                detailsContent = document.createElement('div');
                detailsContent.className = 'readme-details-content';
                resetList();
                continue;
            }
            if (trimmed.startsWith('</details>')) {
                if (detailsEl && detailsContent) {
                    detailsEl.appendChild(detailsContent);
                    content.appendChild(detailsEl);
                }
                inDetailsBlock = false;
                detailsEl = null;
                detailsContent = null;
                resetList();
                continue;
            }
            if (inDetailsBlock && trimmed.startsWith('<summary>')) {
                const summaryText = trimmed
                    .replace(/<\/?summary>/g, '')
                    .replace(/<\/?(?:b|strong)>/g, '')
                    .trim();
                const summary = document.createElement('summary');
                summary.className = 'readme-details-summary';
                const strong = document.createElement('strong');
                strong.textContent = summaryText;
                summary.appendChild(strong);
                detailsEl?.appendChild(summary);
                continue;
            }

            // Table detection
            if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                if (!inTable) {
                    inTable = true;
                    tableRows = [];
                    tableParent = currentListItem && isIndented(line) ? currentListItem : getTarget();
                    if (!isIndented(line) && currentListItem) resetList();
                }
                // Skip separator rows
                if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
                    continue;
                }
                tableRows.push(trimmed);
                continue;
            }
            if (inTable) {
                inTable = false;
                const table = this.#buildTable(tableRows);
                (tableParent ?? getTarget()).appendChild(table);
                tableRows = [];
                tableParent = null;
                // Fall through to process current line normally
            }

            if (trimmed === '') {
                continue;
            }

            // Sub-headings within body (shouldn't typically happen, but just in case)
            if (/^#{1,4} /.test(line)) {
                resetList();
                const sub = document.createElement('h4');
                sub.className = 'readme-subheading';
                sub.textContent = line.replace(/^#{1,4} /, '').trim();
                getTarget().appendChild(sub);
                continue;
            }

            // Blockquotes: > text
            if (/^\s*> /.test(line)) {
                const bq = document.createElement('blockquote');
                bq.className = 'readme-blockquote';
                this.#renderFormattedText(bq, trimmed.replace(/^>\s*/, ''));
                appendBlock(bq, line);
                continue;
            }

            // List items
            if (/^\s*[-*] /.test(line)) {
                const li = document.createElement('li');
                const text = trimmed.replace(/^[-*] /, '');
                this.#renderFormattedText(li, text);

                if (currentListItem && isIndented(line)) {
                    if (!currentNestedList) {
                        currentNestedList = document.createElement('ul');
                        currentNestedList.className = 'readme-list readme-list-nested';
                        currentListItem.appendChild(currentNestedList);
                    }
                    currentNestedList.appendChild(li);
                } else {
                    const list = ensureList('ul');
                    list.appendChild(li);
                    currentListItem = li;
                    currentNestedList = null;
                }
                continue;
            }

            // Ordered list items: 1. text
            if (/^\s*\d+\. /.test(line)) {
                const list = ensureList('ol');
                const li = document.createElement('li');
                this.#renderFormattedText(li, trimmed.replace(/^\d+\. /, ''));
                list.appendChild(li);
                currentListItem = li;
                currentNestedList = null;
                continue;
            }

            // Plain paragraph
            const p = document.createElement('p');
            p.className = 'readme-paragraph';
            this.#renderFormattedText(p, trimmed);
            appendBlock(p, line);
        }

        // Flush remaining table
        if (inTable && tableRows.length > 0) {
            const table = this.#buildTable(tableRows);
            (tableParent ?? getTarget()).appendChild(table);
        }

        block.appendChild(content);
        return block;
    }

    #buildTable(rows: string[]): HTMLElement {
        const table = document.createElement('table');
        table.className = 'readme-table';

        rows.forEach((row, i) => {
            const cells = row.split('|').filter((c) => c.trim() !== '');
            const tr = document.createElement('tr');
            cells.forEach((cell) => {
                const el = document.createElement(i === 0 ? 'th' : 'td');
                this.#renderFormattedText(el, cell.trim());
                tr.appendChild(el);
            });
            if (i === 0) {
                const thead = document.createElement('thead');
                thead.appendChild(tr);
                table.appendChild(thead);
            } else {
                let tbody = table.querySelector('tbody');
                if (!tbody) {
                    tbody = document.createElement('tbody');
                    table.appendChild(tbody);
                }
                tbody.appendChild(tr);
            }
        });

        const wrapper = document.createElement('div');
        wrapper.className = 'readme-table-wrapper';
        wrapper.appendChild(table);
        return wrapper;
    }

    #appendLink(parent: HTMLElement, label: string, href: string): void {
        const a = document.createElement('a');
        a.textContent = label;
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        parent.appendChild(a);
    }

    /**
     * Renders text with **bold**, `code`, and [links](url) into a parent element.
     * Uses textContent/createElement for CSP safety.
     */
    #renderFormattedText(parent: HTMLElement, text: string): void {
        const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
        for (const part of parts) {
            if (part.startsWith('**') && part.endsWith('**')) {
                const strong = document.createElement('strong');
                this.#renderFormattedText(strong, part.slice(2, -2));
                parent.appendChild(strong);
            } else if (part.startsWith('`') && part.endsWith('`')) {
                const code = document.createElement('code');
                code.textContent = part.slice(1, -1);
                parent.appendChild(code);
            } else if (part.startsWith('[')) {
                const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
                if (linkMatch) {
                    this.#appendLink(parent, linkMatch[1], linkMatch[2]);
                } else {
                    parent.appendChild(document.createTextNode(part));
                }
            } else if (part) {
                parent.appendChild(document.createTextNode(part));
            }
        }
    }
}
