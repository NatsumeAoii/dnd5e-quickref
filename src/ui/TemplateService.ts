import { CONFIG } from '../config.js';
import { safeHTML } from '../utils/Utils.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { RuleData, RuleInfo, Bullet } from '../types.js';

export class TemplateService {
    #domProvider: DOMProvider;

    constructor(domProvider: DOMProvider) { this.#domProvider = domProvider; }

    #renderers: Record<string, (bullet: Bullet, linkifyFn: (html: string) => string) => HTMLElement> = {
        paragraph: (bullet, linkifyFn) => {
            const p = document.createElement('p');
            p.innerHTML = safeHTML(linkifyFn(bullet.content || '')) as string;
            return p;
        },
        list: (bullet, linkifyFn) => {
            const ul = document.createElement('ul');
            (bullet.items || []).forEach((itemText) => {
                const li = document.createElement('li');
                li.innerHTML = safeHTML(linkifyFn(itemText)) as string;
                ul.appendChild(li);
            });
            return ul;
        },
        table: (bullet, linkifyFn) => {
            const table = document.createElement('table');
            table.className = 'rule-table';
            if (bullet.headers?.length) {
                const thead = table.createTHead();
                const headerRow = thead.insertRow();
                bullet.headers.forEach((headerText) => {
                    const th = document.createElement('th');
                    th.textContent = headerText;
                    headerRow.appendChild(th);
                });
            }
            if (bullet.rows?.length) {
                const tbody = table.createTBody();
                bullet.rows.forEach((rowData) => {
                    const row = tbody.insertRow();
                    rowData.forEach((cellData) => {
                        const cell = row.insertCell();
                        cell.innerHTML = safeHTML(linkifyFn(String(cellData ?? ''))) as string;
                    });
                });
            }
            return table;
        },
    };

    #renderBullets(bullets: Bullet[] | undefined, linkifyFn: (html: string) => string): DocumentFragment {
        const fragment = document.createDocumentFragment();
        if (!Array.isArray(bullets)) return fragment;
        bullets.forEach((bullet) => {
            const renderer = this.#renderers[bullet.type];
            if (renderer) fragment.appendChild(renderer(bullet, linkifyFn));
            else {
                console.warn(`Unknown bullet type: "${bullet.type}"`);
                const p = document.createElement('p');
                p.textContent = JSON.stringify(bullet);
                fragment.appendChild(p);
            }
        });
        return fragment;
    }

    createRuleItemElement(popupId: string, ruleData: RuleData, isFavorite: boolean): HTMLElement {
        const tpl = this.#domProvider.getTemplate(CONFIG.ELEMENT_IDS.RULE_ITEM_TEMPLATE);
        const item = (tpl.content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement;
        const ruleType = ruleData.optional || CONFIG.DEFAULTS.RULE_TYPE;
        const title = ruleData.title || CONFIG.DEFAULTS.TITLE;

        item.setAttribute(CONFIG.ATTRIBUTES.RULE_TYPE, ruleType);
        item.setAttribute(CONFIG.ATTRIBUTES.POPUP_ID, popupId);
        item.setAttribute('draggable', 'true');

        const iconEl = item.querySelector('.item-icon') as HTMLElement;
        iconEl.className = 'item-icon iconsize';
        iconEl.setAttribute(CONFIG.ATTRIBUTES.ICON, ruleData.icon || CONFIG.DEFAULTS.ICON);

        item.querySelector('.item-title')!.textContent = title;
        item.querySelector('.item-desc')!.textContent = ruleData.subtitle || '';
        item.querySelector('.favorite-btn')!.classList.toggle(CONFIG.CSS.IS_FAVORITED, isFavorite);
        return item;
    }

    createPopupElement(popupId: string, { ruleData, type, sectionId }: RuleInfo, linkifyFn: (html: string) => string, getNoteFn: (id: string) => string): HTMLElement {
        const tpl = this.#domProvider.getTemplate(CONFIG.ELEMENT_IDS.POPUP_TEMPLATE);
        const popup = (tpl.content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement;
        const sourceSection = document.getElementById(sectionId)?.closest(`.${CONFIG.CSS.SECTION_CONTAINER}`);
        const borderColor = sourceSection ? window.getComputedStyle(sourceSection).borderColor : 'var(--color-hr)';

        popup.setAttribute('aria-labelledby', `popup-title-${popupId}`);
        popup.style.setProperty('--section-color', borderColor);

        const titleEl = popup.querySelector('.popup-title') as HTMLElement;
        titleEl.id = `popup-title-${popupId}`;
        titleEl.textContent = ruleData.title || CONFIG.DEFAULTS.TITLE;

        (popup.querySelector('.popup-header') as HTMLElement).style.backgroundColor = borderColor;
        popup.querySelector('.popup-type')!.textContent = type;
        (popup.querySelector('.popup-description') as HTMLElement).innerHTML = safeHTML(linkifyFn(ruleData.description || ruleData.subtitle || '')) as string;
        (popup.querySelector('.popup-summary') as HTMLElement).innerHTML = safeHTML(linkifyFn(ruleData.summary || '')) as string;
        popup.querySelector('.popup-bullets')!.replaceChildren(this.#renderBullets(ruleData.bullets, linkifyFn));

        const refContainer = popup.querySelector('.popup-reference-container') as HTMLElement;
        const referenceEl = refContainer.querySelector('.popup-reference') as HTMLElement;
        const toggleBtn = refContainer.querySelector('.popup-toggle-details-btn') as HTMLElement;

        if (ruleData.reference) {
            referenceEl.textContent = ruleData.reference;
            referenceEl.classList.remove(CONFIG.CSS.HIDDEN);
        } else {
            referenceEl.classList.add(CONFIG.CSS.HIDDEN);
        }

        if (!ruleData.bullets?.length) {
            toggleBtn.classList.add(CONFIG.CSS.HIDDEN);
            if (!ruleData.summary) popup.querySelector('.popup-summary')!.classList.add(CONFIG.CSS.HIDDEN);
        }

        const textarea = popup.querySelector('.popup-notes-textarea') as HTMLTextAreaElement;
        const notesLabel = popup.querySelector('.popup-notes-label') as HTMLElement;
        notesLabel.setAttribute('for', `notes-${popupId}`);
        textarea.id = `notes-${popupId}`;
        textarea.value = getNoteFn(popupId);
        return popup;
    }
}
