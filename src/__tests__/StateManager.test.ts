// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateManager } from '../state/StateManager.js';

describe('StateManager', () => {
    let sm: StateManager;

    beforeEach(() => {
        sm = new StateManager();
    });

    it('should initialize with default state', () => {
        const state = sm.getState();
        expect(state).toBeDefined();
        expect(state.settings).toBeDefined();
        expect(state.user).toBeDefined();
        expect(state.ui).toBeDefined();
        expect(state.data).toBeDefined();
    });

    it('should allow subscribing and publishing events', () => {
        const callback = vi.fn();
        sm.subscribe('testEvent', callback);
        sm.publish('testEvent', { key: 'value' });
        expect(callback).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith({ key: 'value' });
    });

    it('should call multiple listeners for the same event', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        sm.subscribe('multi', cb1);
        sm.subscribe('multi', cb2);
        sm.publish('multi', 42);
        expect(cb1).toHaveBeenCalledWith(42);
        expect(cb2).toHaveBeenCalledWith(42);
    });

    it('should not call listeners for different events', () => {
        const callback = vi.fn();
        sm.subscribe('eventA', callback);
        sm.publish('eventB', 'data');
        expect(callback).not.toHaveBeenCalled();
    });

    it('should isolate listener errors (one bad listener does not break others)', () => {
        const badCb = vi.fn(() => { throw new Error('boom'); });
        const goodCb = vi.fn();
        sm.subscribe('errorTest', badCb);
        sm.subscribe('errorTest', goodCb);

        // Should not throw
        expect(() => sm.publish('errorTest', 'data')).not.toThrow();
        expect(badCb).toHaveBeenCalled();
        expect(goodCb).toHaveBeenCalled();
    });

    it('should unsubscribe a callback', () => {
        const callback = vi.fn();
        sm.subscribe('unsub', callback);
        sm.unsubscribe('unsub', callback);
        sm.publish('unsub', 'data');
        expect(callback).not.toHaveBeenCalled();
    });

    it('should return an unsubscribe function from subscribe', () => {
        const callback = vi.fn();
        const unsubscribe = sm.subscribe('returnedUnsub', callback);

        unsubscribe();
        sm.publish('returnedUnsub', 'data');

        expect(callback).not.toHaveBeenCalled();
    });

    it('should publish to a stable listener snapshot when listeners unsubscribe during publish', () => {
        const second = vi.fn();
        const first = vi.fn(() => {
            sm.unsubscribe('snapshot', second);
        });
        sm.subscribe('snapshot', first);
        sm.subscribe('snapshot', second);

        sm.publish('snapshot', 'data');

        expect(first).toHaveBeenCalledWith('data');
        expect(second).toHaveBeenCalledWith('data');
    });

    it('should not throw when unsubscribing a non-existent callback', () => {
        const callback = vi.fn();
        expect(() => sm.unsubscribe('nope', callback)).not.toThrow();
    });

    it('should handle publish with no data argument', () => {
        const callback = vi.fn();
        sm.subscribe('nodata', callback);
        sm.publish('nodata');
        expect(callback).toHaveBeenCalledWith(undefined);
    });

    it('should delete event key from listeners map when all callbacks are unsubscribed', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        sm.subscribe('cleanup', cb1);
        sm.subscribe('cleanup', cb2);

        sm.unsubscribe('cleanup', cb1);
        // After removing one callback, the event should still receive publishes to the remaining listener
        sm.publish('cleanup', 'still active');
        expect(cb2).toHaveBeenCalledWith('still active');

        sm.unsubscribe('cleanup', cb2);
        // After removing all callbacks, publishing should be a no-op (event key deleted, no empty array)
        const cb3 = vi.fn();
        sm.publish('cleanup', 'gone');
        expect(cb3).not.toHaveBeenCalled();

        // Re-subscribing should work cleanly (proves the key was fully removed, not left as empty array)
        sm.subscribe('cleanup', cb3);
        sm.publish('cleanup', 'new');
        expect(cb3).toHaveBeenCalledWith('new');
    });

    it('should remove only the specific callback when unsubscribing', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const cb3 = vi.fn();
        sm.subscribe('specific', cb1);
        sm.subscribe('specific', cb2);
        sm.subscribe('specific', cb3);

        sm.unsubscribe('specific', cb2);
        sm.publish('specific', 'data');

        expect(cb1).toHaveBeenCalledWith('data');
        expect(cb2).not.toHaveBeenCalled();
        expect(cb3).toHaveBeenCalledWith('data');
    });
});
