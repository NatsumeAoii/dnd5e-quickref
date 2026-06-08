// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { CONFIG } from '../config.js';
import { StateManager } from '../state/StateManager.js';
import { GamepadService } from '../services/GamepadService.js';
import { WakeLockService } from '../services/WakeLockService.js';
import { SettingsService } from '../services/SettingsService.js';
import { PerformanceOptimizer } from '../services/PerformanceOptimizer.js';

/**
 * Feature: codebase-quality-improvements, Property 6: Absent runtime capability degrades without error
 *
 * Property 6: Absent runtime capability degrades without error
 *
 * For any boundary whose capability is removed from the environment
 * (`navigator.getGamepads` absent, `navigator.wakeLock` absent,
 * `window.matchMedia` absent), constructing and operating the owning service
 * SHALL raise no uncaught error and SHALL continue capability-independent
 * operations.
 *
 * **Validates: Requirements 4.5, 5.4**
 */

/** Minimal in-memory Storage stub for SettingsService construction. */
const createStorage = (initial: Record<string, string> = {}): Storage => {
    const data = new Map(Object.entries(initial));
    return {
        get length() { return data.size; },
        clear: vi.fn(() => data.clear()),
        getItem: vi.fn((key: string) => data.get(key) ?? null),
        key: vi.fn((index: number) => Array.from(data.keys())[index] ?? null),
        removeItem: vi.fn((key: string) => { data.delete(key); }),
        setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    };
};

/**
 * Remove a navigator capability so feature detection sees it as absent.
 * `delete` alone cannot remove prototype-defined methods, so we shadow the
 * symbol with an `undefined` own property and then delete it where possible.
 */
const setNavigatorCapabilityUndefined = (name: string): void => {
    Object.defineProperty(navigator, name, { configurable: true, value: undefined });
};

/** Make a navigator capability fail the `name in navigator` feature check. */
const deleteNavigatorCapability = (name: string): void => {
    Object.defineProperty(navigator, name, { configurable: true, value: undefined });
    delete (navigator as unknown as Record<string, unknown>)[name];
};

describe('Feature: codebase-quality-improvements, Property 6: Absent runtime capability degrades without error', () => {
    beforeEach(() => {
        // Prevent the gamepad poll loop from recursing via real rAF scheduling.
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('GamepadService construction and polling tolerate an absent navigator.getGamepads', () => {
        fc.assert(
            fc.property(
                fc.record({
                    connect: fc.boolean(),
                    visibilityToggles: fc.integer({ min: 0, max: 4 }),
                    destroyAtEnd: fc.boolean(),
                }),
                ({ connect, visibilityToggles, destroyAtEnd }) => {
                    setNavigatorCapabilityUndefined('getGamepads');

                    const domProvider = { queryAll: vi.fn(() => []), get: vi.fn() } as never;
                    const service = new GamepadService(domProvider);

                    // Operate: simulate connection + visibility changes that drive polling.
                    if (connect) window.dispatchEvent(new Event('gamepadconnected'));
                    for (let i = 0; i < visibilityToggles; i++) {
                        document.dispatchEvent(new Event('visibilitychange'));
                    }

                    // Capability-independent operation must still work.
                    if (destroyAtEnd) service.destroy();
                    else service.destroy();

                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });

    it('WakeLockService construction and operation tolerate an absent navigator.wakeLock', () => {
        fc.assert(
            fc.property(
                fc.array(fc.boolean(), { minLength: 0, maxLength: 6 }),
                fc.integer({ min: 0, max: 4 }),
                (enabledToggles, visibilityToggles) => {
                    deleteNavigatorCapability('wakeLock');
                    expect('wakeLock' in navigator).toBe(false);

                    const service = new WakeLockService();

                    // Operate: toggle enablement and dispatch visibility changes.
                    for (const enabled of enabledToggles) service.setEnabled(enabled);
                    for (let i = 0; i < visibilityToggles; i++) {
                        document.dispatchEvent(new Event('visibilitychange'));
                    }

                    // Capability-independent teardown must still work (idempotent).
                    service.destroy();
                    service.destroy();

                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });

    it('matchMedia-owning services construct and operate with an absent window.matchMedia', () => {
        fc.assert(
            fc.property(
                fc.record({
                    storedMode: fc.option(fc.constantFrom('true', 'false'), { nil: undefined }),
                    use2024: fc.boolean(),
                    showOptional: fc.boolean(),
                }),
                ({ storedMode, use2024, showOptional }) => {
                    // Remove the matchMedia capability entirely.
                    vi.stubGlobal('matchMedia', undefined);
                    expect(window.matchMedia).toBeUndefined();

                    const initial: Record<string, string> = {};
                    if (storedMode !== undefined) initial[CONFIG.STORAGE_KEYS.MODE] = storedMode;
                    if (use2024) initial[CONFIG.STORAGE_KEYS.RULES_2024] = 'true';
                    if (showOptional) initial[CONFIG.STORAGE_KEYS.OPTIONAL] = 'true';

                    const stateManager = new StateManager();

                    // PerformanceOptimizer owns a matchMedia boundary in shouldReduceMotion().
                    const optimizer = new PerformanceOptimizer();
                    const reduceMotion = optimizer.shouldReduceMotion();
                    expect(typeof reduceMotion).toBe('boolean');

                    // SettingsService owns a matchMedia boundary in initialize() (dark-mode detection).
                    const settings = new SettingsService(
                        createStorage(initial),
                        stateManager,
                        { broadcast: vi.fn() } as never,
                        optimizer,
                    );
                    settings.initialize();

                    const state = stateManager.getState();
                    // Capability-independent operations still complete.
                    expect(state.settings.use2024Rules).toBe(use2024);
                    expect(state.settings.showOptional).toBe(showOptional);
                    // matchMedia-dependent dark-mode detection falls back without throwing.
                    if (storedMode === undefined) {
                        expect(state.settings.darkMode).toBe(false);
                    } else {
                        expect(state.settings.darkMode).toBe(storedMode === 'true');
                    }

                    optimizer.destroy();
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });
});
