// @vitest-environment jsdom
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { resolve, dirname } from 'node:path';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../config.js';
import { DOMProvider } from '../services/DOMProvider.js';
import { A11yService } from '../services/A11yService.js';
import { ChangelogService } from '../services/ChangelogService.js';
import { ReadmeService } from '../services/ReadmeService.js';
import { OnboardingService } from '../services/OnboardingService.js';
import { GamepadService } from '../services/GamepadService.js';

/**
 * Task 8.2 — Confirm startup behavior unchanged after DeferredLoader removal (C1).
 *
 * DeferredLoader.loadDeferredServices() was a no-op warm-up that has been deleted.
 * These tests pin the contract that the four services it referenced (Changelog,
 * Readme, Onboarding, Gamepad) remain eagerly constructed during startup exactly
 * as before, and that no DeferredLoader / loadDeferredServices references remain in
 * the bootstrap path — so observable startup behavior is identical.
 *
 * Requirements: 6.6 (previously passing behavior preserved), 2.2 (observable
 * startup output identical for non-defect changes).
 */
const currentDir = dirname(fileURLToPath(import.meta.url)) as string;
const mainSource = readFileSync(resolve(currentDir, '../main.ts'), 'utf8') as string;

describe('Startup services — eager construction preserved after DeferredLoader removal', () => {
    beforeEach(() => {
        document.body.innerHTML = `<div id="${CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER}" aria-live="polite"></div>`;
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('constructs the four previously-deferred services at startup without throwing', () => {
        const domProvider = new DOMProvider();
        const a11y = new A11yService(domProvider);

        let gamepad: GamepadService | null = null;
        expect(() => {
            const onboarding = new OnboardingService(window.localStorage, a11y);
            const changelog = new ChangelogService(a11y);
            const readme = new ReadmeService(a11y);
            gamepad = new GamepadService(domProvider);

            // Confirm each service is a live instance, mirroring main.ts #initializeServices().
            expect(onboarding).toBeInstanceOf(OnboardingService);
            expect(changelog).toBeInstanceOf(ChangelogService);
            expect(readme).toBeInstanceOf(ReadmeService);
            expect(gamepad).toBeInstanceOf(GamepadService);
        }).not.toThrow();

        // The services expose their startup-observable surface immediately.
        const onboarding = new OnboardingService(window.localStorage, a11y);
        expect(onboarding.isActive).toBe(false);
        expect(new ChangelogService(a11y).isModalOpen).toBe(false);
        expect(new ReadmeService(a11y).isModalOpen).toBe(false);

        (gamepad as GamepadService | null)?.destroy();
    });

    it('keeps the four services eagerly constructed in main.ts #initializeServices()', () => {
        const initBody = mainSource.match(/#initializeServices\(\):\s*void\s*\{([\s\S]*?)\n {4}\}/)?.[1] ?? '';
        expect(initBody).not.toBe('');

        expect(initBody).toContain('new OnboardingService(');
        expect(initBody).toContain('new ChangelogService(');
        expect(initBody).toContain('new ReadmeService(');
        expect(initBody).toContain('new GamepadService(');

        // All four must be wired into the #services record so startup keeps them alive.
        ['onboarding', 'changelog', 'readme', 'gamepad'].forEach((name) => {
            expect(initBody).toContain(name);
        });
    });

    it('contains no DeferredLoader or loadDeferredServices references in the bootstrap path', () => {
        expect(mainSource).not.toMatch(/DeferredLoader/);
        expect(mainSource).not.toMatch(/loadDeferredServices/);
    });
});
