// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import * as fc from 'fast-check';

import { fetchWithTimeout } from '../utils/Utils.js';

/**
 * Feature: codebase-quality-improvements
 * Property 5: Bounded fetch timeout aborts within the limit
 *
 * For any fetch initiated through `fetchWithTimeout` against a never-resolving
 * response and any timeout value, the returned promise SHALL settle (reject with
 * an abort) within the configured bound, which SHALL never exceed 10 seconds.
 *
 * Validates: Requirements 5.5, 5.6
 */

const TEN_SECONDS_MS = 10_000;
const TEST_URL = 'https://example.test/resource.json';

/**
 * Builds a `fetch` stub that never resolves on its own. It only settles by
 * rejecting with the `AbortSignal`'s reason once that signal aborts, faithfully
 * modelling a hung network response that honours abort.
 */
const createHangingFetch = (): typeof fetch =>
    vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) return; // No signal: hang forever (should not occur via fetchWithTimeout).
            const rejectWithAbort = (): void => {
                reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
            };
            if (signal.aborted) {
                rejectWithAbort();
                return;
            }
            signal.addEventListener('abort', rejectWithAbort, { once: true });
        });
    }) as unknown as typeof fetch;

const isAbortError = (error: unknown): boolean =>
    error instanceof Error && error.name === 'AbortError';

describe('Feature: codebase-quality-improvements, Property 5: Bounded fetch timeout aborts within the limit', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('aborts a never-resolving fetch exactly at the capped bound, never exceeding 10s', async () => {
        await fc.assert(
            fc.asyncProperty(
                // Span values below, at, and well above the 10s cap to exercise Math.min(timeoutMs, 10_000).
                fc.integer({ min: 1, max: 30_000 }),
                async (timeoutMs) => {
                    vi.useFakeTimers();
                    vi.stubGlobal('fetch', createHangingFetch());
                    try {
                        const effectiveBound = Math.min(timeoutMs, TEN_SECONDS_MS);

                        // The effective bound is the core guarantee: it never exceeds 10 seconds.
                        expect(effectiveBound).toBeLessThanOrEqual(TEN_SECONDS_MS);

                        let settled = false;
                        let rejectedWithAbort = false;
                        const tracked = fetchWithTimeout(TEST_URL, timeoutMs).then(
                            () => {
                                settled = true;
                            },
                            (error: unknown) => {
                                settled = true;
                                rejectedWithAbort = isAbortError(error);
                            },
                        );

                        // Before reaching the bound the request must still be in flight.
                        if (effectiveBound > 1) {
                            await vi.advanceTimersByTimeAsync(effectiveBound - 1);
                            expect(settled).toBe(false);
                            await vi.advanceTimersByTimeAsync(1);
                        } else {
                            await vi.advanceTimersByTimeAsync(effectiveBound);
                        }

                        await tracked;

                        // At the bound the promise has settled by aborting.
                        expect(settled).toBe(true);
                        expect(rejectedWithAbort).toBe(true);
                    } finally {
                        vi.useRealTimers();
                        vi.unstubAllGlobals();
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
