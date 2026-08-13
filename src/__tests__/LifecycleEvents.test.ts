import { describe, expect, it, vi } from 'vitest';
import { StateManager } from '../state/StateManager.js';
import { UserDataService } from '../services/UserDataService.js';

describe('state event lifecycle contracts', () => {
    it('publishes reorder and note mutation events', async () => {
        const stateManager = new StateManager();
        const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 } as never;
        const userData = new UserDataService(
            storage,
            stateManager,
            { getAll: vi.fn(async () => ({})), put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) } as never,
            { broadcast: vi.fn() } as never,
        );
        const reordered = vi.fn();
        const notesChanged = vi.fn();
        stateManager.subscribe('favoritesReordered', reordered);
        stateManager.subscribe('notesChanged', notesChanged);

        userData.updateFavoritesOrder(['Action::Dash']);
        await userData.saveNote('Action::Dash', 'Remember this');

        expect(reordered).toHaveBeenCalledWith({ ids: ['Action::Dash'] });
        expect(notesChanged).toHaveBeenCalledWith({ id: 'Action::Dash', text: 'Remember this' });
    });

    it('clears subscriptions safely during StateManager teardown', () => {
        const stateManager = new StateManager();
        const listener = vi.fn();
        stateManager.subscribe('favoritesChanged', listener);
        stateManager.destroy();
        stateManager.publish('favoritesChanged');
        expect(listener).not.toHaveBeenCalled();
        expect(() => stateManager.destroy()).not.toThrow();
    });
});
