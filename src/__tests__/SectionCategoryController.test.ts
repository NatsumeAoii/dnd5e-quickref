// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config.js';
import { SectionCategoryController } from '../ui/SectionCategoryController.js';

describe('SectionCategoryController', () => {
    it('restores persisted collapse state and renders an expanded section once', async () => {
        document.body.innerHTML = `
            <section id="section-action" class="${CONFIG.CSS.SECTION_CONTAINER}" data-section="action">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}"><button class="section-toggle" type="button"></button></h2>
                <div class="${CONFIG.CSS.SECTION_CONTENT}"></div>
            </section>
        `;
        window.localStorage.setItem(CONFIG.STORAGE_KEYS.SECTION_STATES, JSON.stringify({ action: true }));
        const controller = new SectionCategoryController({
            domProvider: {
                queryAll: (selector: string) => document.querySelectorAll(selector),
                get: (id: string) => document.getElementById(id) as HTMLElement,
            } as never,
            stateManager: { getState: vi.fn() } as never,
            a11y: { announce: vi.fn() } as never,
            navigation: { invalidateFocusables: vi.fn() } as never,
            viewRenderer: { filterRuleItems: vi.fn(), showNotification: vi.fn() } as never,
            renderSingleSection: vi.fn(),
            localization: { translate: (_key: string, fallback: string) => fallback } as never,
            data: { ensureSectionDataLoaded: vi.fn(), buildRuleMap: vi.fn(), getDataSourceKey: vi.fn(() => 'action') } as never,
        });

        controller.setupCollapsibleSections();
        const section = document.getElementById('section-action')!;
        expect(section.classList.contains(CONFIG.CSS.IS_COLLAPSED)).toBe(true);

        section.querySelector('.section-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        expect(section.classList.contains(CONFIG.CSS.IS_COLLAPSED)).toBe(false);
    });

    it('shows a loading state, exposes category retry, and recovers after a failed load', async () => {
        document.body.innerHTML = `
            <section id="section-action" class="${CONFIG.CSS.SECTION_CONTAINER}" data-section="action">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}"><button class="section-toggle" type="button"></button></h2>
                <div class="${CONFIG.CSS.SECTION_CONTENT}"><div class="section-row"></div></div>
            </section>
        `;
        let attempts = 0;
        const ensureSectionDataLoaded = vi.fn(async () => {
            attempts++;
            if (attempts === 1) throw new TypeError('offline');
        });
        const controller = new SectionCategoryController({
            domProvider: {
                queryAll: (selector: string) => document.querySelectorAll(selector),
                get: (id: string) => document.getElementById(id) as HTMLElement,
            } as never,
            stateManager: { getState: vi.fn() } as never,
            a11y: { announce: vi.fn() } as never,
            navigation: { invalidateFocusables: vi.fn() } as never,
            viewRenderer: { filterRuleItems: vi.fn(), renderSection: vi.fn(), showNotification: vi.fn() } as never,
            renderSingleSection: vi.fn((_section: { id: string }) => {
                const item = document.createElement('div');
                item.className = CONFIG.CSS.ITEM_CLASS;
                document.querySelector('.section-row')?.appendChild(item);
            }),
            localization: { translate: (_key: string, fallback: string) => fallback } as never,
            data: {
                ensureSectionDataLoaded,
                buildRuleMap: vi.fn(),
                getDataSourceKey: vi.fn(() => 'action'),
                getSectionLoadStatus: vi.fn(() => 'ready'),
            } as never,
        });

        const section = document.getElementById('section-action')!;
        await controller.renderSectionContent(section);
        expect(section.dataset.loadState).toBe('offline');
        const retry = section.querySelector<HTMLButtonElement>('[data-section-retry]');
        expect(retry).not.toBeNull();

        await retry!.click();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(ensureSectionDataLoaded).toHaveBeenCalledTimes(2);
        expect(section.dataset.loadState).toBe('ready');
    });
});
