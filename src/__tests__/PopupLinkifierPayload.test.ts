// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateManager } from '../state/StateManager.js';
import { PopupLinkifier } from '../ui/PopupLinkifier.js';

/**
 * Reproduces defect A2 (Requirement 4.4): a `settingChanged` event whose payload
 * is null, undefined, or a non-object must not throw and must leave the linkifier's
 * internal cache untouched.
 *
 * Pre-fix the subscriber ran `const { key } = data as { key: string }`, so a
 * null/undefined payload threw a TypeError. `StateManager.publish` swallows
 * subscriber throws and reports them via `console.error`, so the pre-fix defect
 * surfaces as a logged listener error (red); the guarded post-fix code logs nothing
 * and never clears the cache (green).
 */

const toShortId = (id: string): string => id.toLowerCase().replace(/::/g, '-');

// A regex linker is required for `linkify` to populate its cache; without a trie
// or regex it returns the input unchanged before touching the cache.
const createLinkifier = () => {
    const stateManager = new StateManager();
    const state = stateManager.getState();
    state.data.ruleLinkerRegex = /Fireball/g;
    state.data.titleLookup = new Map([['fireball', 'Spell::Fireball']]);
    const linkifier = new PopupLinkifier(stateManager, toShortId);
    return { stateManager, state, linkifier };
};

const HTML = '<p>Fireball</p>';

// The exact malformed payloads called out by task 1.7.
const MALFORMED_PAYLOADS: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number 42', 42],
    ['empty object {}', {}],
];

describe('PopupLinkifier malformed settingChanged payloads (A2, Requirement 4.4)', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not throw or log a listener error for any malformed payload', () => {
        const { stateManager } = createLinkifier();

        for (const [, payload] of MALFORMED_PAYLOADS) {
            expect(() => stateManager.publish('settingChanged', payload as never)).not.toThrow();
        }

        // Pre-fix, null/undefined payloads throw inside the subscriber and
        // StateManager reports them via console.error. The guard suppresses that.
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('leaves the linkify cache untouched for every malformed payload', () => {
        const { stateManager, state, linkifier } = createLinkifier();

        // Prime the cache with a result that links "Fireball" -> Spell::Fireball.
        const primed = linkifier.linkify(HTML);
        expect(primed).toContain(`#${toShortId('Spell::Fireball')}`);

        // Swap the lookup so that *if* the cache were cleared, recomputation would
        // produce a different href than the cached value.
        state.data.titleLookup = new Map([['fireball', 'Spell::Changed']]);

        for (const [, payload] of MALFORMED_PAYLOADS) {
            stateManager.publish('settingChanged', payload as never);
            // Cache untouched -> the originally cached (old) result is still served.
            expect(linkifier.linkify(HTML)).toBe(primed);
        }

        // Sanity: a cache *clear* on the rule-set key does recompute with the new
        // lookup, proving the untouched assertion above is meaningful.
        stateManager.publish('settingChanged', { key: 'RULES_2024', value: true });
        expect(linkifier.linkify(HTML)).toContain(`#${toShortId('Spell::Changed')}`);
    });
});
