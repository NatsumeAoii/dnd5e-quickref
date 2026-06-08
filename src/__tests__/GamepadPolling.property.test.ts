// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { GamepadService } from '../services/GamepadService.js';

/**
 * Property test for Feature: codebase-quality-improvements, Property 1:
 * Gamepad polling tolerates any button-array shape.
 *
 * For any gamepad snapshot whose `buttons` array has arbitrary length
 * (including empty) and whose `axes` array is arbitrary, a single `#poll`
 * cycle must complete without throwing and must schedule the next animation
 * frame. The poll is entered synchronously via the `gamepadconnected` handler;
 * `requestAnimationFrame` is the final statement of `#poll`, so observing a
 * call to it proves the cycle ran to completion past the `gp.buttons[0]`
 * access that defect A1 concerned.
 */

const NEVER_THROWS_QUERY = { queryAll: () => [] as HTMLElement[], get: vi.fn() };

/** Builds a minimal Gamepad-like snapshot with caller-supplied buttons/axes. */
const createGamepadSnapshot = (
    buttons: readonly GamepadButton[],
    axes: readonly number[],
): Gamepad => ({
    axes,
    buttons,
    connected: true,
    id: 'test-gamepad',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
    vibrationActuator: null,
} as unknown as Gamepad);

/** Arbitrary GamepadButton — pressed/touched/value vary independently. */
const buttonArb: fc.Arbitrary<GamepadButton> = fc.record({
    pressed: fc.boolean(),
    touched: fc.boolean(),
    value: fc.double({ min: 0, max: 1, noNaN: true }),
}) as unknown as fc.Arbitrary<GamepadButton>;

describe('GamepadService polling tolerance (Property 1)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('completes a poll cycle and schedules the next frame for any button-array shape', () => {
        fc.assert(
            fc.property(
                // Arbitrary-length buttons, including empty (minLength 0).
                fc.array(buttonArb, { minLength: 0, maxLength: 8 }),
                // Arbitrary axes: lengths below and above the 2-axis threshold,
                // and values that may exceed the 0.5 navigation deadzone.
                fc.array(fc.double({ min: -2, max: 2, noNaN: true }), { minLength: 0, maxLength: 6 }),
                (buttons, axes) => {
                    const gamepad = createGamepadSnapshot(buttons, axes);
                    Object.defineProperty(navigator, 'getGamepads', {
                        configurable: true,
                        value: vi.fn(() => [gamepad]),
                    });
                    // Stub rAF so it records the scheduling call without
                    // recursively re-entering the poll (avoids an infinite loop).
                    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 99);

                    const service = new GamepadService(NEVER_THROWS_QUERY as never);

                    // `gamepadconnected` triggers the initial synchronous poll cycle.
                    expect(() => window.dispatchEvent(new Event('gamepadconnected'))).not.toThrow();
                    // Reaching rAF proves the cycle completed past the buttons access.
                    expect(raf).toHaveBeenCalledWith(expect.any(Function));

                    service.destroy();
                    raf.mockRestore();
                },
            ),
            { numRuns: 100 },
        );
    });
});
