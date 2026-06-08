// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { PopupLinkifier } from '../ui/PopupLinkifier.js';
import { StateManager } from '../state/StateManager.js';

/**
 * Property 2: PopupLinkifier ignores malformed settingChanged payloads
 *
 * For any `settingChanged` payload that is null, undefined, a non-object, or an
 * object lacking a string `key`, dispatching the event SHALL leave the
 * linkifier's internal cache unchanged and SHALL NOT throw.
 *
 * Feature: codebase-quality-improvements, Property 2: PopupLinkifier ignores malformed settingChanged payloads
 *
 * **Validates: Requirements 4.2, 4.3**
 *
 * Observation strategy:
 * - The `#cache` is private. We prime it by calling `linkify(html)` once, which
 *   stores the rendered result keyed by `html`. On a subsequent `linkify(html)`
 *   the method returns early from the cache BEFORE calling `document.createElement`.
 *   So "cache unchanged" is observed as: after dispatching a malformed payload,
 *   the next `linkify(html)` is a cache hit (no `createElement` rebuild). If the
 *   cache had been cleared, the rebuild path would run and call `createElement`.
 * - StateManager.publish wraps each subscriber in try/catch and logs via
 *   console.error, so a throw inside the subscriber would surface as a logged
 *   error rather than a propagated exception. "SHALL NOT throw" is therefore
 *   observed as: console.error is never called while dispatching the payload.
 */

const HTML = '<p>Dash across the battlefield</p>';

/** Payloads that are NOT objects (null, undefined, primitives). */
const nonObjectArb = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.integer(),
    fc.double({ noNaN: false }),
    fc.string(),
    fc.boolean(),
);

/**
 * Payloads that ARE objects but lack a string `key`:
 * empty objects, arrays, objects without a `key` field, and objects whose
 * `key` is explicitly a non-string value. None of these generators ever
 * produce a string `key`, so none should clear the cache.
 */
const objectWithoutStringKeyArb = fc.oneof(
    fc.constant({}),
    fc.constant([]),
    fc.array(fc.anything()),
    fc.record({ value: fc.anything() }),
    fc.record({ notKey: fc.anything(), other: fc.anything() }),
    fc.record({
        key: fc.oneof(
            fc.integer(),
            fc.double({ noNaN: false }),
            fc.boolean(),
            fc.constant(null),
            fc.constant(undefined),
            fc.object(),
            fc.array(fc.anything()),
        ),
    }),
);

const malformedPayloadArb = fc.oneof(nonObjectArb, objectWithoutStringKeyArb);

describe('Property 2: PopupLinkifier ignores malformed settingChanged payloads', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('leaves the cache unchanged and never throws for malformed payloads', () => {
        fc.assert(
            fc.property(malformedPayloadArb, (payload) => {
                const stateManager = new StateManager();
                // Enable a regex matcher so linkify processes and caches the result.
                stateManager.getState().data.ruleLinkerRegex = /Dash/g;
                const linkifier = new PopupLinkifier(stateManager, (id) => id);

                // Prime the cache: this stores the rendered result keyed by HTML.
                const primed = linkifier.linkify(HTML);
                expect(primed).toBeTruthy();

                // Install spies AFTER priming so they observe only the dispatch + re-render.
                const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
                const createElementSpy = vi.spyOn(document, 'createElement');

                // Dispatching the malformed payload must not throw out of publish.
                expect(() => stateManager.publish('settingChanged', payload)).not.toThrow();

                // The guard prevents the subscriber from throwing, so StateManager
                // never logs a listener error.
                expect(consoleErrorSpy).not.toHaveBeenCalled();

                // Cache is unchanged: the next linkify is a cache hit, so no rebuild
                // (no document.createElement) occurs and the result is identical.
                const afterDispatch = linkifier.linkify(HTML);
                expect(createElementSpy).not.toHaveBeenCalled();
                expect(afterDispatch).toBe(primed);

                consoleErrorSpy.mockRestore();
                createElementSpy.mockRestore();
            }),
            { numRuns: 100 },
        );
    });
});
