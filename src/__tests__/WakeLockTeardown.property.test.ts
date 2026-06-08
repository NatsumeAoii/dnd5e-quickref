// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { WakeLockService } from '../services/WakeLockService.js';

/**
 * Property 4: Idempotent teardown removes listeners and never throws
 *
 * For any number of consecutive `destroy()` invocations (one or more) on
 * WakeLockService, every invocation SHALL complete without throwing, and after
 * the first invocation the `visibilitychange` listener SHALL NOT fire its
 * lock-request path on subsequent visibility changes.
 *
 * Feature: codebase-quality-improvements, Property 4: Idempotent teardown removes listeners and never throws
 *
 * **Validates: Requirements 5.1, 5.2, 5.3**
 */
describe('Feature: codebase-quality-improvements, Property 4: Idempotent teardown removes listeners and never throws', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        // Remove the stubbed wakeLock capability between iterations/tests.
        // delete is safe because we (re)define it as configurable below.
        delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
    });

    /**
     * Creates a fake WakeLockSentinel plus a spy-backed `navigator.wakeLock`
     * whose `request` resolves to the sentinel. Returns the request spy so the
     * test can assert whether the lock-request path was exercised.
     */
    const stubWakeLock = (): ReturnType<typeof vi.fn> => {
        const sentinel = new EventTarget() as WakeLockSentinel;
        Object.assign(sentinel, {
            released: false,
            type: 'screen',
            release: vi.fn(async () => undefined),
        });
        const request = vi.fn(async () => sentinel);
        Object.defineProperty(navigator, 'wakeLock', {
            configurable: true,
            value: { request },
        });
        return request;
    };

    it('survives N consecutive destroy() calls and stops responding to visibilitychange', async () => {
        await fc.assert(
            fc.asyncProperty(
                // One or more consecutive destroy() invocations.
                fc.integer({ min: 1, max: 10 }),
                async (destroyCount) => {
                    const request = stubWakeLock();
                    const service = new WakeLockService();

                    // Arm the service so the visibilitychange handler would, if
                    // still attached, take the lock-request path on a 'visible'
                    // visibility change (jsdom defaults visibilityState to 'visible').
                    service.setEnabled(true);
                    await Promise.resolve();
                    await Promise.resolve();

                    // Clear any request calls made while arming the service so the
                    // post-teardown assertion only observes new activity.
                    request.mockClear();

                    // Every consecutive destroy() must complete without throwing.
                    for (let i = 0; i < destroyCount; i++) {
                        expect(() => service.destroy()).not.toThrow();
                    }

                    // After the first destroy the listener is removed and the
                    // service disabled, so a dispatched visibilitychange must NOT
                    // fire the lock-request path.
                    document.dispatchEvent(new Event('visibilitychange'));
                    await Promise.resolve();
                    await Promise.resolve();

                    expect(request).not.toHaveBeenCalled();
                },
            ),
            { numRuns: 100 },
        );
    });
});
