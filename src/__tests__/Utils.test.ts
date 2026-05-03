// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, DOMElementNotFoundError, DataLoadError, installPrintRestoreFallback, safeHTML, trapFocusWithin } from '../utils/Utils.js';

describe('debounce', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('should delay execution', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);
        debounced();
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('should reset timer on subsequent calls', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);
        debounced();
        vi.advanceTimersByTime(50);
        debounced();
        vi.advanceTimersByTime(50);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(50);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('should only fire once for rapid calls', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);
        for (let i = 0; i < 10; i++) debounced();
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledOnce();
    });
});

describe('Custom Error Classes', () => {
    it('DOMElementNotFoundError should have correct name and message', () => {
        const err = new DOMElementNotFoundError('test-id');
        expect(err.name).toBe('DOMElementNotFoundError');
        expect(err.message).toContain('test-id');
        expect(err).toBeInstanceOf(Error);
    });

    it('DataLoadError should have correct name and message', () => {
        const err = new DataLoadError('some-file.json');
        expect(err.name).toBe('DataLoadError');
        expect(err.message).toContain('some-file.json');
        expect(err).toBeInstanceOf(Error);
    });
});

describe('safeHTML', () => {
    it('removes active content, event handlers, and unsafe URL protocols', () => {
        const clean = safeHTML(`
            <p onclick="steal()">Text</p>
            <style>body{display:none}</style>
            <a href="javascript:alert(1)">bad</a>
            <img src="data:text/html,<script>alert(1)</script>" onerror="steal()">
            <a href="/rules">ok</a>
        `);

        expect(clean).not.toContain('onclick');
        expect(clean).not.toContain('<style');
        expect(clean).not.toContain('javascript:');
        expect(clean).not.toContain('data:text/html');
        expect(clean).toContain('href="/rules"');
    });

    it('removes unsafe URL protocols even when protocol text is HTML entity encoded', () => {
        const clean = safeHTML('<a href="java&#x73;cript:alert(1)">bad</a>');

        expect(clean).not.toContain('href=');
    });

    it('preserves the safe rule markup and generated rule links used by the app', () => {
        const clean = safeHTML('<b>Bold</b> <i>Italic</i> <a class="rule-link" data-popup-id="Action::Dash">Dash</a>');

        expect(clean).toBe('<b>Bold</b> <i>Italic</i> <a class="rule-link" data-popup-id="Action::Dash">Dash</a>');
    });

    it('drops unknown tags while preserving their text content', () => {
        const clean = safeHTML('<svg><title>bad</title></svg><b>ok</b>');

        expect(clean).toBe('bad<b>ok</b>');
    });
});

describe('installPrintRestoreFallback', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('restores print state with a bounded timer when afterprint never fires', () => {
        vi.useFakeTimers();
        const restore = vi.fn();

        const restoreNow = installPrintRestoreFallback(restore, 100);
        vi.advanceTimersByTime(100);
        restoreNow();

        expect(restore).toHaveBeenCalledOnce();
    });
});

describe('trapFocusWithin', () => {
    it('wraps Tab focus from the last focusable element back to the first', () => {
        document.body.innerHTML = `
            <div id="modal">
                <button id="first">First</button>
                <button id="last">Last</button>
            </div>
            <button id="outside">Outside</button>
        `;
        const modal = document.getElementById('modal') as HTMLElement;
        const first = document.getElementById('first') as HTMLElement;
        const last = document.getElementById('last') as HTMLElement;
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
        const preventDefault = vi.spyOn(event, 'preventDefault');

        last.focus();
        trapFocusWithin(event, modal);

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(first);
    });
});
