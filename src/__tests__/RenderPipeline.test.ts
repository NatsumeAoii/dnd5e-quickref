// @vitest-environment jsdom
/**
 * #20: Integration tests for the render pipeline — verifies that rule data
 * flows through TemplateService → ViewRenderer → DOM correctly, and that
 * the sanitizer + linkifier pipeline doesn't introduce XSS vectors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config.js';
import { StateManager } from '../state/StateManager.js';
import { TemplateService } from '../ui/TemplateService.js';
import { ViewRenderer } from '../ui/ViewRenderer.js';
import type { RuleData, RuleInfo } from '../types.js';

const createMinimalDOM = (): void => {
    document.body.innerHTML = `
        <template id="${CONFIG.ELEMENT_IDS.RULE_ITEM_TEMPLATE}">
            <div class="${CONFIG.CSS.ITEM_CLASS} ${CONFIG.CSS.ITEM_SIZE_CLASS}">
                <div class="item-icon iconsize"></div>
                <button type="button" class="item-content" tabindex="0">
                    <div class="item-title"></div>
                    <div class="item-desc"></div>
                </button>
                <button type="button" class="favorite-btn" aria-pressed="false"></button>
            </div>
        </template>
        <template id="${CONFIG.ELEMENT_IDS.POPUP_TEMPLATE}">
            <dialog class="${CONFIG.CSS.POPUP_WINDOW}">
                <div class="popup-header">
                    <span class="popup-title"></span>
                    <span class="popup-type"></span>
                    <button class="${CONFIG.CSS.POPUP_CLOSE_BTN}">×</button>
                    <button class="${CONFIG.CSS.POPUP_MINIMIZE_BTN}">_</button>
                </div>
                <div class="popup-content" tabindex="-1">
                    <div class="popup-description"></div>
                    <div class="popup-summary"></div>
                    <div class="popup-bullets"></div>
                    <div class="popup-reference-container">
                        <span class="popup-reference hidden"></span>
                        <button class="popup-toggle-details-btn" aria-expanded="true">Tell Me Less</button>
                        <button class="popup-copy-link-btn">Copy Link</button>
                    </div>
                    <div class="popup-notes">
                        <label class="popup-notes-label">Notes</label>
                        <textarea class="popup-notes-textarea"></textarea>
                        <span class="popup-notes-status"></span>
                    </div>
                </div>
            </dialog>
        </template>
        <div id="${CONFIG.ELEMENT_IDS.NOTIFICATION_CONTAINER}"></div>
        <div id="${CONFIG.ELEMENT_IDS.SKELETON_LOADER}"></div>
        <div id="${CONFIG.ELEMENT_IDS.APP_CONTAINER}" class="hidden" style="opacity:0">
            <main id="${CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA}">
                <div id="basic-actions" class="section-row"></div>
            </main>
        </div>
    `;
};

const createDomProvider = () => ({
    get: (id: string) => {
        const el = document.getElementById(id);
        if (!el) throw new Error(`Element #${id} not found`);
        return el;
    },
    getTemplate: (id: string) => document.getElementById(id) as HTMLTemplateElement,
    queryAll: (selector: string) => document.querySelectorAll(selector),
});

describe('Render pipeline integration', () => {
    beforeEach(() => {
        createMinimalDOM();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('renders rule items with correct attributes and text content', () => {
        const domProvider = createDomProvider();
        const stateManager = new StateManager();
        const templateService = new TemplateService(domProvider as never);
        const userData = { isFavorite: () => false } as never;
        const viewRenderer = new ViewRenderer(domProvider as never, stateManager, userData, templateService);

        const rules = [
            {
                popupId: 'Action::Dash',
                ruleInfo: {
                    ruleData: { title: 'Dash', subtitle: 'Double movement', icon: 'sprint', optional: 'Standard rule' },
                    type: 'Action',
                    sectionId: 'basic-actions',
                } as RuleInfo,
            },
        ];

        viewRenderer.renderSection('basic-actions', rules);

        const item = document.querySelector(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement;
        expect(item).not.toBeNull();
        expect(item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID)).toBe('Action::Dash');
        expect(item.getAttribute(CONFIG.ATTRIBUTES.RULE_TYPE)).toBe('Standard rule');
        expect(item.querySelector('.item-title')?.textContent).toBe('Dash');
        expect(item.querySelector('.item-desc')?.textContent).toBe('Double movement');
    });

    it('strips XSS vectors from rule descriptions in rendered popups', () => {
        const domProvider = createDomProvider();
        const templateService = new TemplateService(domProvider as never);
        const maliciousRule: RuleInfo = {
            ruleData: {
                title: 'Evil Rule',
                description: '<img src=x onerror=alert(1)><script>steal()</script><b>safe</b>',
                bullets: [{ type: 'paragraph', content: '<a href="javascript:alert(1)">click</a> normal text' }],
            } as RuleData,
            type: 'Action',
            sectionId: 'basic-actions',
        };

        const popup = templateService.createPopupElement(
            'Action::Evil Rule',
            maliciousRule,
            (html) => html, // no linkification for this test
            () => '',
        );

        const descriptionHTML = popup.querySelector('.popup-description')?.innerHTML ?? '';
        expect(descriptionHTML).not.toContain('onerror');
        expect(descriptionHTML).not.toContain('<script>');
        expect(descriptionHTML).toContain('<b>safe</b>');

        const bulletsHTML = popup.querySelector('.popup-bullets')?.innerHTML ?? '';
        expect(bulletsHTML).not.toContain('javascript:');
        expect(bulletsHTML).toContain('normal text');
    });

    it('renders table bullets with correct structure and sanitized cells', () => {
        const domProvider = createDomProvider();
        const templateService = new TemplateService(domProvider as never);
        const rule: RuleInfo = {
            ruleData: {
                title: 'Table Rule',
                description: 'Has a table',
                bullets: [{
                    type: 'table',
                    headers: ['DC', 'Effect'],
                    rows: [['10', '<b>Normal</b>'], ['15', '<img src=x onerror=alert(1)>Hard']],
                }],
            } as RuleData,
            type: 'Action',
            sectionId: 'basic-actions',
        };

        const popup = templateService.createPopupElement('Action::Table Rule', rule, (h) => h, () => '');

        const table = popup.querySelector('table.rule-table');
        expect(table).not.toBeNull();
        const headers = table!.querySelectorAll('th');
        expect(headers).toHaveLength(2);
        expect(headers[0].textContent).toBe('DC');
        expect(headers[1].textContent).toBe('Effect');

        const cells = table!.querySelectorAll('td');
        expect(cells).toHaveLength(4);
        expect(cells[1].innerHTML).toContain('<b>Normal</b>');
        expect(cells[3].innerHTML).not.toContain('onerror');
    });

    it('applies optional/homebrew filtering after rendering', () => {
        const domProvider = createDomProvider();
        const stateManager = new StateManager();
        stateManager.getState().settings.showOptional = false;
        stateManager.getState().settings.showHomebrew = false;
        const templateService = new TemplateService(domProvider as never);
        const userData = { isFavorite: () => false } as never;
        const viewRenderer = new ViewRenderer(domProvider as never, stateManager, userData, templateService);

        const rules = [
            {
                popupId: 'Action::Dash',
                ruleInfo: { ruleData: { title: 'Dash', optional: 'Standard rule' }, type: 'Action', sectionId: 'basic-actions' } as RuleInfo,
            },
            {
                popupId: 'Action::Climb*',
                ruleInfo: { ruleData: { title: 'Climb*', optional: 'Optional rule' }, type: 'Action', sectionId: 'basic-actions' } as RuleInfo,
            },
            {
                popupId: 'Action::Homebrew**',
                ruleInfo: { ruleData: { title: 'Homebrew**', optional: 'Homebrew rule' }, type: 'Action', sectionId: 'basic-actions' } as RuleInfo,
            },
        ];

        viewRenderer.renderSection('basic-actions', rules);

        const items = document.querySelectorAll(`.${CONFIG.CSS.ITEM_CLASS}`);
        expect(items).toHaveLength(3);
        // Standard rule visible
        expect((items[0] as HTMLElement).style.display).not.toBe('none');
        // Optional rule hidden
        expect((items[1] as HTMLElement).style.display).toBe('none');
        // Homebrew rule hidden
        expect((items[2] as HTMLElement).style.display).toBe('none');
    });

    it('defaults popups to summary view when summary exists', () => {
        const domProvider = createDomProvider();
        const templateService = new TemplateService(domProvider as never);
        const rule: RuleInfo = {
            ruleData: {
                title: 'Ready',
                description: 'Prepare an action',
                summary: 'Set a trigger and react',
                bullets: [{ type: 'paragraph', content: 'Detailed explanation here.' }],
            } as RuleData,
            type: 'Action',
            sectionId: 'basic-actions',
        };

        const popup = templateService.createPopupElement('Action::Ready', rule, (h) => h, () => '');

        const bullets = popup.querySelector('.popup-bullets') as HTMLElement;
        const toggleBtn = popup.querySelector('.popup-toggle-details-btn') as HTMLElement;
        expect(bullets.classList.contains(CONFIG.CSS.HIDDEN)).toBe(true);
        expect(toggleBtn.textContent).toBe('Tell Me More');
        expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    });
});
