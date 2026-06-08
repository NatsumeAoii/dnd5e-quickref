// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamepadService } from '../services/GamepadService.js';

/**
 * Builds a minimal Gamepad-like snapshot for polling tests.
 * `axes: [0, 0]` keeps the analog sticks centred so the poll cycle enters the
 * movement/button block (axes.length >= 2) but skips DOM navigation, isolating
 * the `gp.buttons[0]` access that defect A1 concerns.
 */
const createGamepadSnapshot = (buttons: readonly GamepadButton[]): Gamepad => ({
    axes: [0, 0],
    buttons,
    connected: true,
    id: 'test-gamepad',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
    vibrationActuator: null,
} as unknown as Gamepad);

describe('GamepadService empty-buttons defect (A1)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('completes a poll cycle without throwing when buttons is explicitly empty', () => {
        // A connected gamepad reporting an empty `buttons` array. Pre-fix,
        // `gp.buttons[0].pressed` threw `TypeError: Cannot read properties of
        // undefined (reading 'pressed')`. Post-fix, the bounds guard skips
        // button handling and the loop still schedules the next frame.
        const gamepad = createGamepadSnapshot([]);
        Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value: vi.fn(() => [gamepad]),
        });

        // `requestAnimationFrame` is the final statement of `#poll`; it is only
        // reached after the button access. Stub it so it does not re-invoke the
        // poll (avoiding an infinite loop) while recording that the cycle ran to
        // completion.
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 99);
        const focusedClick = vi.fn();
        const focused = document.createElement('button');
        focused.click = focusedClick;
        document.body.appendChild(focused);
        focused.focus();

        const service = new GamepadService({ queryAll: vi.fn(() => []), get: vi.fn() } as never);

        // `gamepadconnected` triggers the initial synchronous poll cycle.
        expect(() => window.dispatchEvent(new Event('gamepadconnected'))).not.toThrow();

        // The poll reached its final statement, proving it did not throw on the
        // empty buttons array (pre-fix it would have thrown before this line).
        expect(raf).toHaveBeenCalledWith(expect.any(Function));
        // No button was pressed, so no synthetic click should have fired.
        expect(focusedClick).not.toHaveBeenCalled();

        service.destroy();
    });

    it('handles a pressed primary button when present (guard does not break valid input)', () => {
        const pressedButton = { pressed: true, touched: true, value: 1 } as GamepadButton;
        const gamepad = createGamepadSnapshot([pressedButton]);
        Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value: vi.fn(() => [gamepad]),
        });
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 99);

        const focusedClick = vi.fn();
        const focused = document.createElement('button');
        focused.click = focusedClick;
        document.body.appendChild(focused);
        focused.focus();

        const service = new GamepadService({ queryAll: vi.fn(() => []), get: vi.fn() } as never);

        expect(() => window.dispatchEvent(new Event('gamepadconnected'))).not.toThrow();
        expect(focusedClick).toHaveBeenCalledTimes(1);

        service.destroy();
    });
});
