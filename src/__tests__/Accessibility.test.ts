// @vitest-environment jsdom
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const loadIndex = (): Document => {
    const cwd = (globalThis as typeof globalThis & { process: { cwd: () => string } }).process.cwd();
    const html = readFileSync(`${cwd}/index.html`, 'utf8');
    return new DOMParser().parseFromString(html, 'text/html');
};

const parseColorVars = (css: string, selector: string): Record<string, string> => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
    const vars: Record<string, string> = {};
    match?.[1]?.replace(/--(color-[\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g, (_m, name: string, value: string) => {
        vars[name] = value;
        return '';
    });
    return vars;
};

const contrastRatio = (fg: string, bg: string): number => {
    const expand = (hex: string): string => hex.length === 4
        ? `#${[...hex.slice(1)].map((char) => char + char).join('')}`
        : hex;
    const channels = (hex: string): number[] => expand(hex).slice(1).match(/../g)!.map((value) => {
        const channel = parseInt(value, 16) / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = (hex: string): number => {
        const [red, green, blue] = channels(hex);
        return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
    };
    const [lighter, darker] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
};

const queryTemplate = (doc: Document, templateId: string, selector: string): Element | null => {
    const template = doc.getElementById(templateId) as HTMLTemplateElement | null;
    return template?.content.querySelector(selector) ?? null;
};

describe('Static accessibility semantics', () => {
    it('uses native buttons for primary custom controls instead of role button shims', () => {
        const doc = loadIndex();

        const ruleActivator = queryTemplate(doc, 'rule-item-template', '.item-content');
        expect(ruleActivator?.tagName).toBe('BUTTON');
        expect(ruleActivator?.getAttribute('type')).toBe('button');
        expect(ruleActivator?.hasAttribute('role')).toBe(false);
        expect(ruleActivator?.hasAttribute('tabindex')).toBe(false);

        ['export-notes-btn', 'import-notes-btn', 'export-favorites-btn'].forEach((id) => {
            const control = doc.getElementById(id);
            expect(control?.tagName).toBe('BUTTON');
            expect(control?.getAttribute('type')).toBe('button');
            expect(control?.hasAttribute('role')).toBe(false);
            expect(control?.hasAttribute('tabindex')).toBe(false);
        });
    });

    it('keeps collapsible section headings semantic while exposing native toggle buttons', () => {
        const doc = loadIndex();
        const sectionIds = [
            'section-movement',
            'section-action',
            'section-bonus-action',
            'section-reaction',
            'section-condition',
            'section-environment',
        ];

        sectionIds.forEach((sectionId) => {
            const heading = doc.querySelector(`#${sectionId} > .section-title`);
            const toggle = heading?.querySelector('.section-toggle');
            const content = doc.getElementById(`${sectionId}-content`);

            expect(heading?.tagName).toBe('H2');
            expect(toggle?.tagName).toBe('BUTTON');
            expect(toggle?.getAttribute('type')).toBe('button');
            expect(toggle?.getAttribute('aria-controls')).toBe(`${sectionId}-content`);
            expect(toggle?.getAttribute('aria-expanded')).toBe('true');
            expect(toggle?.hasAttribute('role')).toBe(false);
            expect(toggle?.hasAttribute('tabindex')).toBe(false);
            expect(content).not.toBeNull();
        });
    });

    it('provides live-region semantics for visual notifications', () => {
        const doc = loadIndex();
        const notifications = doc.getElementById('notification-container');

        expect(notifications?.getAttribute('role')).toBe('status');
        expect(notifications?.getAttribute('aria-live')).toBe('polite');
        expect(notifications?.getAttribute('aria-atomic')).toBe('false');
    });

    it('uses a heading for popup dialog titles', () => {
        const doc = loadIndex();
        const title = queryTemplate(doc, 'popup-template', '.popup-title');

        expect(title?.tagName).toBe('H2');
    });

    it('documents the keyboard path for reordering favorites', () => {
        const doc = loadIndex();
        const subtitle = doc.querySelector('#section-favorites .section-title-subtitle');

        expect(subtitle?.textContent).toContain('Shift+Arrow');
    });

    it('keeps the programmatic notes file picker out of the visible tab order with a name', () => {
        const doc = loadIndex();
        const fileInput = doc.getElementById('import-notes-input');

        expect(fileInput?.getAttribute('tabindex')).toBe('-1');
        expect(fileInput?.getAttribute('aria-label')).toBe('Import notes file');
    });

    it('sets non-submit buttons to type button explicitly', () => {
        const doc = loadIndex();
        const buttons = [
            ...doc.querySelectorAll('button'),
            ...[...doc.querySelectorAll('template')].flatMap((template) =>
                [...(template as HTMLTemplateElement).content.querySelectorAll('button')]
            ),
        ];

        expect(buttons.filter((button) => !button.hasAttribute('type')).map((button) =>
            button.id || button.className || button.textContent?.trim()
        )).toEqual([]);
    });

    it('keeps theme text and section header color pairs at WCAG AA contrast', () => {
        const cwd = (globalThis as typeof globalThis & { process: { cwd: () => string } }).process.cwd();
        const baseCss = readFileSync(`${cwd}/src/css/quickref.css`, 'utf8');
        expect(baseCss).not.toMatch(/\.section-title-subtitle\s*\{[^}]*opacity:\s*0?\.[0-9]+/s);
        const sectionTokens = [
            'movement',
            'action',
            'bonus-action',
            'reaction',
            'condition',
            'environment',
            'settings',
            'favorite',
        ];
        const scenarios = [
            { name: 'original light', vars: parseColorVars(baseCss, ':root') },
            {
                name: 'original dark',
                vars: {
                    ...parseColorVars(baseCss, ':root'),
                    ...parseColorVars(baseCss, "[data-mode='dark']"),
                },
            },
            ...['sepia', 'high-contrast', 'nord', 'cyberpunk', 'steampunk'].flatMap((theme) => {
                const themeCss = readFileSync(`${cwd}/public/themes/${theme}.css`, 'utf8');
                return (['light', 'dark'] as const).map((mode) => ({
                    name: `${theme} ${mode}`,
                    vars: {
                        ...parseColorVars(baseCss, ':root'),
                        ...(mode === 'dark' ? parseColorVars(baseCss, "[data-mode='dark']") : {}),
                        ...parseColorVars(themeCss, `html[data-theme='${theme}'][data-mode='${mode}']`),
                    },
                }));
            }),
        ];

        const failures: string[] = [];
        scenarios.forEach(({ name, vars }) => {
            [
                ['text/bg', vars['color-text'], vars['color-bg']],
                ['subtle/card', vars['color-text-subtle'], vars['color-card-bg']],
                ['link/bg', vars['color-link'], vars['color-bg']],
                ['link/card', vars['color-link'], vars['color-card-bg']],
            ].forEach(([label, fg, bg]) => {
                if (fg && bg && contrastRatio(fg, bg) < 4.5) failures.push(`${name} ${label}`);
            });
            sectionTokens.forEach((token) => {
                const fg = vars[`color-${token}-text`] ?? vars['color-header-text'];
                const bg = vars[`color-${token}`];
                if (fg && bg && contrastRatio(fg, bg) < 4.5) failures.push(`${name} header/${token}`);
            });
        });

        expect(failures).toEqual([]);
    });
});
