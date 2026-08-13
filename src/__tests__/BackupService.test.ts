import { describe, expect, it, vi } from 'vitest';
import { BackupService, validateBackupBundle } from '../services/BackupService.js';
import { StateManager } from '../state/StateManager.js';

const makeBackup = (
    stateManager: StateManager,
    db: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> },
    applyImportedSettings = vi.fn(),
) => new BackupService(
    stateManager,
    { ...db } as never,
    { applyImportedSettings } as never,
);

describe('BackupService', () => {
    it('creates and previews a bounded versioned bundle', () => {
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.settings = { locale: 'en_US', use2024Rules: false, theme: 'original', density: 'normal', darkMode: false, reduceMotion: false } as never;
        state.user.favorites.add('Action::Dash');
        state.user.notes.set('Action::Dash', 'Remember');
        const service = makeBackup(stateManager, { put: vi.fn(), delete: vi.fn() });
        const bundle = service.createBundle();
        expect(validateBackupBundle(bundle).format).toBe('dnd5e-quickref-backup');
        expect(service.preview(bundle)).toMatchObject({ favorites: 1, notes: 1 });
    });

    it('restores section states from a backup', async () => {
        const stateManager = new StateManager();
        stateManager.getState().settings = {
            locale: 'en_US',
            use2024Rules: false,
            theme: 'original',
            density: 'normal',
            darkMode: false,
            reduceMotion: false,
        } as never;
        const stored = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => { stored.set(key, value); },
            removeItem: (key: string) => { stored.delete(key); },
        });
        const service = makeBackup(stateManager, { put: vi.fn(), delete: vi.fn() });
        const bundle = service.createBundle();
        bundle.sectionStates = { action: true };

        await service.apply(bundle, 'replace');

        expect(JSON.parse(stored.get('sectionStates') ?? '{}')).toEqual({ action: true });
        vi.unstubAllGlobals();
    });

    it('rejects malformed and unsupported backups', () => {
        expect(() => validateBackupBundle({})).toThrow('Unsupported backup format');
        expect(() => validateBackupBundle({ format: 'dnd5e-quickref-backup', version: 1, favorites: [], notes: {}, settings: {}, sectionStates: {} })).toThrow('Backup settings');
    });

    it.each([
        ['unsupported locale', { locale: 'xx_XX' }],
        ['non-boolean ruleset', { use2024Rules: 'true' }],
        ['unsupported theme', { theme: '../outside' }],
        ['unsupported density', { density: 'spacious' }],
        ['non-boolean dark mode', { darkMode: 1 }],
        ['non-boolean reduced motion', { reduceMotion: null }],
    ])('rejects %s settings before import', (_description, change) => {
        const settings = {
            locale: 'en_US', use2024Rules: false, theme: 'original', density: 'normal', darkMode: false, reduceMotion: false,
            ...change,
        };
        expect(() => validateBackupBundle({
            format: 'dnd5e-quickref-backup', version: 1, favorites: [], notes: {}, settings, sectionStates: {},
        })).toThrow('Backup settings are invalid.');
    });

    it('rejects malformed settings before replace mode can delete notes', async () => {
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.settings = { locale: 'en_US', use2024Rules: false, theme: 'original', density: 'normal', darkMode: false, reduceMotion: false } as never;
        state.user.notes.set('existing', 'keep me');
        const db = { put: vi.fn(), delete: vi.fn() };
        const service = makeBackup(stateManager, db);
        const bundle = service.createBundle();
        bundle.settings = { ...bundle.settings, density: 'invalid' };

        await expect(service.apply(bundle, 'replace')).rejects.toThrow('Backup settings are invalid.');
        expect(db.put).not.toHaveBeenCalled();
        expect(db.delete).not.toHaveBeenCalled();
        expect(state.user.notes.get('existing')).toBe('keep me');
    });

    it('rolls back in-memory state and writes when persistence fails', async () => {
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.settings = { locale: 'en_US', use2024Rules: false, theme: 'original', density: 'normal', darkMode: false, reduceMotion: false } as never;
        state.user.favorites.add('old');
        state.user.notes.set('old', 'old note');
        const db = { put: vi.fn().mockRejectedValue(new Error('disk full')), delete: vi.fn() };
        const service = makeBackup(stateManager, db);
        const bundle = service.createBundle();
        bundle.favorites = ['new'];
        bundle.notes = { new: 'new note' };
        await expect(service.apply(bundle, 'replace')).rejects.toThrow('disk full');
        expect([...state.user.favorites]).toEqual(['old']);
        expect(state.user.notes.get('old')).toBe('old note');
    });

    it('restores notes deleted by replace mode when a later import step fails', async () => {
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.settings = { locale: 'en_US', use2024Rules: false, theme: 'original', density: 'normal', darkMode: false, reduceMotion: false } as never;
        state.user.notes.set('removed', 'restore me');
        const db = { put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
        const applyImportedSettings = vi.fn(() => { throw new Error('settings failed'); });
        const service = makeBackup(stateManager, db, applyImportedSettings);
        const bundle = service.createBundle();
        bundle.notes = {};

        await expect(service.apply(bundle, 'replace')).rejects.toThrow('settings failed');
        expect(db.delete).toHaveBeenCalledWith('removed');
        expect(db.put).toHaveBeenCalledWith('removed', 'restore me');
        expect(state.user.notes.get('removed')).toBe('restore me');
    });
});
