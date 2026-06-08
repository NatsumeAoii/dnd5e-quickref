// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { PopupLinkifier } from '../ui/PopupLinkifier.js';
import { StateManager } from '../state/StateManager.js';

/**
 * Property 3: PopupLinkifier clears cache only on the rule-set key
 *
 * For any `settingChanged` payload that is a well-formed object, the internal
 * cache SHALL be cleared if and only if `key === 'RULES_2024'`, and SHALL remain
 * unchanged for every other key.
 *
 * Feature: codebase-quality-improvements, Property 3: PopupLinkifier clears cache only on the rule-set key
 *
 * **Validates: Requirements 4.2, 4.3**
 *
 * Observation strategy (mirrors the sibling suites 1.5 and 1.7):
 * - The `#cache` is private, so we observe it indirectly through `linkify`.
 *   Priming the cache with `linkify(HTML)` stores the rendered result keyed by
 *   the input HTML; a subsequent `linkify(HTML)` is served from the cache.
 * - We then mutate `state.data.titleLookup` so that a *recomputed* result would
 *   differ from the cached one. After dispatching a well-formed payload:
 *     - if the cache was cleared, the next `linkify(HTML)` recomputes and reflects
 *       the NEW lookup (different href);
 *     - if the cache was untouched, the next `linkify(HTML)` returns the ORIGINAL
 *       cached value (old href).
 *   This gives a decisive, observable difference between "cleared" and "intact".
 */

const RULE_SET_KEY = 'RULES_2024';
const HTML = '<p>Fireball</p>';
const toShortId = (id: string): string => id.toLowerCase().replace(/::/g, '-');

const createLinkifier = () => {
    const stateManager = new StateManager();
    const state = stateManager.getState();
    // A regex linker + lookup is required for `linkify` to populate its cache.
    state.data.ruleLinkerRegex = /Fireball/g;
    state.data.titleLookup = new Map([['fireball', 'Spell::Original']]);
    const linkifier = new PopupLinkifier(stateManager, toShortId);
    return { stateManager, state, linkifier };
};

/**
 * Well-formed `settingChanged` payloads: an object with a string `key` and a
 * boolean|string `value`. Keys are arbitrary strings, and `RULES_2024` is
 * explicitly injected as a frequent case so both branches of the iff are
 * exercised across runs.
 */
const wellFormedPayloadArb = fc.record({
    key: fc.oneof(
        { weight: 1, arbitrary: fc.constant(RULE_SET_KEY) },
        { weight: 3, arbitrary: fc.string() },
    ),
    value: fc.oneof(fc.boolean(), fc.string()),
});

describe('Property 3: PopupLinkifier clears cache only on the rule-set key', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('clears the cache iff key === RULES_2024, and leaves it unchanged otherwise', () => {
        fc.assert(
            fc.property(wellFormedPayloadArb, (payload) => {
                const { stateManager, state, linkifier } = createLinkifier();

                // Prime the cache: links "Fireball" -> Spell::Original.
                const primed = linkifier.linkify(HTML);
                expect(primed).toContain(`#${toShortId('Spell::Original')}`);

                // Swap the lookup so a recompute would yield a different href.
                state.data.titleLookup = new Map([['fireball', 'Spell::Cleared']]);

                expect(() => stateManager.publish('settingChanged', payload)).not.toThrow();

                const after = linkifier.linkify(HTML);

                if (payload.key === RULE_SET_KEY) {
                    // Cache cleared -> recomputed with the new lookup.
                    expect(after).toContain(`#${toShortId('Spell::Cleared')}`);
                    expect(after).not.toBe(primed);
                } else {
                    // Cache intact -> original cached value still served.
                    expect(after).toBe(primed);
                    expect(after).toContain(`#${toShortId('Spell::Original')}`);
                }
            }),
            { numRuns: 100 },
        );
    });
});
