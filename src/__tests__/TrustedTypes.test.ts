// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config.js';

describe('Trusted Types sanitizer policy', () => {
    const originalTrustedTypes = Object.getOwnPropertyDescriptor(window, 'trustedTypes');
    const originalInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');

    afterEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        document.body.replaceChildren();
        if (originalTrustedTypes) Object.defineProperty(window, 'trustedTypes', originalTrustedTypes);
        else Reflect.deleteProperty(window, 'trustedTypes');
        if (originalInnerHTML) Object.defineProperty(Element.prototype, 'innerHTML', originalInnerHTML);
    });

    const installDefaultPolicySink = (): void => {
        let defaultPolicy: { createHTML: (value: string) => unknown } | null = null;
        Object.defineProperty(window, 'trustedTypes', {
            configurable: true,
            value: {
                createPolicy: vi.fn((name: string, rules: { createHTML: (value: string) => unknown; createScriptURL: (value: string) => unknown; createScript: () => string }) => {
                    if (name === 'default') defaultPolicy = rules;
                    return rules;
                }),
            },
        });

        Object.defineProperty(Element.prototype, 'innerHTML', {
            configurable: true,
            get() {
                return originalInnerHTML?.get?.call(this) ?? '';
            },
            set(value: string) {
                const safeValue = typeof value === 'string' && defaultPolicy
                    ? defaultPolicy.createHTML(value)
                    : value;
                originalInnerHTML?.set?.call(this, String(safeValue));
            },
        });
    };

    it('does not recurse when a default Trusted Types policy protects innerHTML sinks', async () => {
        installDefaultPolicySink();

        const { safeHTML } = await import('../utils/Utils.js');

        expect(() => safeHTML('<p onclick="evil()">Text</p><script>alert(1)</script>')).not.toThrow();
        expect(String(safeHTML('<p onclick="evil()">Text</p><script>alert(1)</script>'))).toBe('<p>Text</p>');
    });

    it('renders the keyboard shortcuts modal when Trusted Types sanitizes innerHTML sinks', async () => {
        installDefaultPolicySink();
        const { KeyboardShortcutsService } = await import('../services/KeyboardShortcutsService.js');
        const service = new KeyboardShortcutsService({ announce: vi.fn() } as never);
        service.register('Ctrl+P', 'Print quick reference', 'Tools', vi.fn());

        expect(() => service.open()).not.toThrow();

        expect(document.querySelector('.shortcuts-modal')).toBeInstanceOf(HTMLElement);
        expect(document.querySelector('.shortcuts-close-btn')).toBeInstanceOf(HTMLButtonElement);
        expect([...document.querySelectorAll('kbd')].map((el) => el.textContent)).toContain('Ctrl');
    });

    it('renders onboarding controls when Trusted Types sanitizes innerHTML sinks', async () => {
        installDefaultPolicySink();
        document.body.innerHTML = `
            <section data-section="action">
                <h2 class="section-title">Actions</h2>
                <div class="item"></div>
            </section>
            <section data-section="settings">
                <h2 class="section-title">Settings</h2>
            </section>
            <button id="shortcuts-fab-btn"></button>
            <div id="${CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER}"></div>
        `;
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
        const storage = {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
        };
        const { A11yService } = await import('../services/A11yService.js');
        const { OnboardingService } = await import('../services/OnboardingService.js');
        const a11y = new A11yService({ get: (id: string) => document.getElementById(id) as HTMLElement } as never);
        const service = new OnboardingService(storage as never, a11y);

        expect(() => service.start()).not.toThrow();

        expect(document.querySelector('.onboarding-tooltip')).toBeInstanceOf(HTMLElement);
        expect(document.querySelector('.onboarding-skip-btn')).toBeInstanceOf(HTMLButtonElement);
        expect(document.querySelectorAll('.onboarding-dot')).toHaveLength(4);
    });
});
