// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config.js';
import { StateManager } from '../state/StateManager.js';
import { UserDataService } from '../services/UserDataService.js';

// Feature: codebase-quality-improvements, Task 9.2: Confirm batched persistence path (Requirement 7.5)
//
// Requirement 7.5 guards against the anti-pattern where a persistence operation reads, mutates, and
// rewrites *serialized* storage once per item across a loop of two or more items. The batched
// implementation must instead perform a single in-memory pass and a single write per item with no
// per-item full-store read and no per-item serialized rewrite.

const createStorage = (initial: Record<string, string> = {}): Storage => {
    const data = new Map(Object.entries(initial));
    return {
        get length() { return data.size; },
        clear: vi.fn(() => data.clear()),
        getItem: vi.fn((key: string) => data.get(key) ?? null),
        key: vi.fn((index: number) => Array.from(data.keys())[index] ?? null),
        removeItem: vi.fn((key: string) => { data.delete(key); }),
        setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    };
};

const createUserDataService = (stateManager = new StateManager(), storage: Storage = createStorage()) => {
    const db = {
        getAll: vi.fn(async () => ({} as Record<string, string>)),
        put: vi.fn(async (_key: string, _value: string) => undefined),
        delete: vi.fn(async (_key: string) => undefined),
    };
    const sync = { broadcast: vi.fn() };
    return {
        service: new UserDataService(storage, stateManager, db as never, sync as never),
        stateManager,
        db,
        storage,
        sync,
    };
};

const makeNotesFile = (notes: Record<string, string>): File =>
    new File([JSON.stringify(notes)], 'notes.json', { type: 'application/json' });

describe('UserDataService.importNotes — batched persistence (Requirement 7.5)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('writes each valid note exactly once with no duplicate read-then-rewrite per item', async () => {
        const { service, db } = createUserDataService();
        const notes = {
            'Action::Dash': 'dash note',
            'Action::Dodge': 'dodge note',
            'Bonus action::Aim*': 'aim note',
            'Condition::Prone': 'prone note',
        };

        const written = await service.importNotes(makeNotesFile(notes));

        // Single write per item: N valid notes -> exactly N db.put calls (not 2N from a
        // read-then-rewrite loop, and not a per-item rewrite of the whole collection).
        expect(written).toBe(Object.keys(notes).length);
        expect(db.put).toHaveBeenCalledTimes(Object.keys(notes).length);
        for (const [key, value] of Object.entries(notes)) {
            expect(db.put).toHaveBeenCalledWith(key, value);
        }
    });

    it('does not re-read the full note store per item during import', async () => {
        const { service, db } = createUserDataService();
        const notes = {
            'Action::Dash': 'dash note',
            'Action::Dodge': 'dodge note',
            'Condition::Prone': 'prone note',
        };

        await service.importNotes(makeNotesFile(notes));

        // A per-item read-mutate-rewrite loop would re-read the whole store each iteration.
        // The batched path never calls getAll during import.
        expect(db.getAll).not.toHaveBeenCalled();
    });

    it('does not read or rewrite serialized localStorage per item during import', async () => {
        const { service, storage } = createUserDataService();
        const notes = {
            'Action::Dash': 'dash note',
            'Action::Dodge': 'dodge note',
            'Bonus action::Aim*': 'aim note',
        };

        await service.importNotes(makeNotesFile(notes));

        // No per-item serialized-blob read (getItem) and no serialized rewrite (setItem) of notes.
        expect(storage.getItem).not.toHaveBeenCalledWith(CONFIG.STORAGE_KEYS.NOTES);
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('performs a single in-memory pass, setting each imported note exactly once', async () => {
        const { service, stateManager } = createUserDataService();
        const notes = {
            'Action::Dash': 'dash note',
            'Action::Dodge': 'dodge note',
            'Condition::Prone': 'prone note',
        };

        const notesMap = stateManager.getState().user.notes;
        const setSpy = vi.spyOn(notesMap, 'set');

        await service.importNotes(makeNotesFile(notes));

        // A single in-memory update covering all items: each key is set once, not repeatedly
        // across a read-mutate-rewrite loop.
        expect(setSpy).toHaveBeenCalledTimes(Object.keys(notes).length);
        for (const [key, value] of Object.entries(notes)) {
            expect(setSpy).toHaveBeenCalledWith(key, value);
        }
    });

    it('keeps write count proportional to valid notes only, skipping invalid entries', async () => {
        const { service, db } = createUserDataService();
        const notes = {
            'Action::Dash': 'valid note',
            'invalid-key-without-separator': 'skipped',
            'Action::Dodge': 'valid note 2',
        };

        const written = await service.importNotes(makeNotesFile(notes));

        // Only valid notes are written, each exactly once — confirming the single pass filters
        // before the single batched write phase.
        expect(written).toBe(2);
        expect(db.put).toHaveBeenCalledTimes(2);
        expect(db.put).not.toHaveBeenCalledWith('invalid-key-without-separator', 'skipped');
    });
});
