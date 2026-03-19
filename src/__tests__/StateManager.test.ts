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
});
