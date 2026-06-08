// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WakeLockService } from '../services/WakeLockService.js';

/**
 * Defect B1 reproduction (Requirements 4.4, 5.3).
 *
 * Pre-fix, WakeLockService registered its `visibilitychange` listener with an
 * un-stored inline reference and exposed no teardown method. The listener leaked
 * for the document lifetime, so after a service was discarded a `visibilitychange`
 * event still fired the lock-request path. Calling a (non-existent) `destroy()` also
 * threw. This test fails against that pre-fix code and passes against the fixed
 * service, whose `destroy()` is idempotent and removes the listener.
 */

const stubWakeLock = () => {
    const sentinel = new EventTarget() as WakeLockSentinel;
    Object.assign(sentinel, { released: false, type: 'screen', release: vi.fn(async () => undefined) });
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request },
    });
    return { request };
};

describe('WakeLockService teardown defect (B1)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calling destroy() twice then dispatching visibilitychange requests no lock and does not throw', async () => {
        const { request } = stubWakeLock();
        const service = new WakeLockService();

        // Enable so the live listener would request a lock on a visibilitychange.
        service.setEnabled(true);
        await Promise.resolve();
        request.mockClear();

        // Idempotent teardown: a second destroy() must not throw.
        expect(() => {
            service.destroy();
            service.destroy();
        }).not.toThrow();

        // jsdom defaults visibilityState to 'visible'; dispatch the event the
        // leaked listener used to react to.
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();

        expect(request).not.toHaveBeenCalled();
    });
});
