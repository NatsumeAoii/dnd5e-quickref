// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, DOMElementNotFoundError, DataLoadError } from '../utils/Utils.js';

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
