// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout } from '../utils/Utils.js';

/**
 * Unit tests for `fetchWithTimeout` (B3) against a hung (never-resolving) response.
 *
 * These assert the bounded-timeout contract from Requirement 5.5: a stalled request
 * aborts within the configured bound and the internal timer is always cleared once the
 * promise settles. Fake timers drive the abort deterministically without real waiting.
 */
describe('fetchWithTimeout — hung response', () => {
    let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /**
     * Stubs global fetch with a promise that never resolves on its own and only
     * rejects once the supplied AbortSignal fires — modelling a hung server that the
     * client must abort itself.
     */
    const stubHungFetch = (): ReturnType<typeof vi.fn> => {
        const fetchMock = vi.fn(
            (_url: string, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    const signal = init?.signal;
                    signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                }),
        );
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    };

    it('aborts a hung request once the timeout elapses', async () => {
        stubHungFetch();
        const timeoutMs = 3_000;

        const pending = fetchWithTimeout('/data/en_US/menu.json', timeoutMs);
        const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

        await vi.advanceTimersByTimeAsync(timeoutMs);

        await assertion;
    });

    it('does not abort before the timeout bound is reached', async () => {
        stubHungFetch();
        const timeoutMs = 5_000;

        const pending = fetchWithTimeout('/data/en_US/menu.json', timeoutMs);
        // Attach a settled tracker without leaving an unhandled rejection.
        let settled = false;
        const tracked = pending.then(
            () => { settled = true; },
            () => { settled = true; },
        );

        // Advance to just before the bound: the request must still be in flight.
        await vi.advanceTimersByTimeAsync(timeoutMs - 1);
        expect(settled).toBe(false);

        // Cross the bound: the abort now fires and the promise settles.
        await vi.advanceTimersByTimeAsync(1);
        await tracked;
        expect(settled).toBe(true);
    });

    it('caps the effective timeout at 10 seconds for very large requested values', async () => {
        stubHungFetch();

        const pending = fetchWithTimeout('/data/en_US/menu.json', 60_000);
        const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

        // Even though 60s was requested, the abort must fire at the 10s cap.
        await vi.advanceTimersByTimeAsync(10_000);

        await assertion;
    });

    it('clears the timeout timer when the request settles via abort', async () => {
        stubHungFetch();
        const timeoutMs = 2_000;

        const pending = fetchWithTimeout('/data/en_US/menu.json', timeoutMs);
        const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

        await vi.advanceTimersByTimeAsync(timeoutMs);
        await assertion;

        // finally{} must clear the abort timer so no dangling timer remains.
        expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('clears the timeout timer when the request resolves before the bound', async () => {
        const okResponse = new Response('{}', { status: 200 });
        const fetchMock = vi.fn(() => Promise.resolve(okResponse));
        vi.stubGlobal('fetch', fetchMock);

        const response = await fetchWithTimeout('/data/en_US/menu.json', 4_000);

        expect(response).toBe(okResponse);
        // The timer is cleared on the success path too, so advancing past the bound
        // must not trigger a late abort.
        expect(clearTimeoutSpy).toHaveBeenCalled();
    });
});
