import { CONFIG } from '../config.js';
import type { StateManager } from '../state/StateManager.js';
import type { DBService } from './DBService.js';
import type { UserDataService } from './UserDataService.js';
import { isValidImportedSettings, type ImportedSettings } from './SettingsService.js';

const BACKUP_VERSION = 1;
const MAX_BACKUP_ENTRIES = 1_000;

export interface BackupBundle {
    format: 'dnd5e-quickref-backup';
    version: 1;
    exportedAt: string;
    appVersion: string;
    settings: ImportedSettings;
    favorites: string[];
    notes: Record<string, string>;
    sectionStates: Record<string, boolean>;
}

export interface BackupPreview { favorites: number; notes: number; sections: number; unresolved: string[]; }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export const validateBackupBundle = (value: unknown): BackupBundle => {
    if (!isRecord(value) || value.format !== 'dnd5e-quickref-backup' || value.version !== BACKUP_VERSION) throw new Error('Unsupported backup format or version.');
    if (!Array.isArray(value.favorites) || value.favorites.length > MAX_BACKUP_ENTRIES || !value.favorites.every((id) => typeof id === 'string' && id.length < 300)) throw new Error('Backup favorites are invalid.');
    if (!isRecord(value.notes) || Object.keys(value.notes).length > MAX_BACKUP_ENTRIES || Object.entries(value.notes).some(([key, text]) => key.length >= 300 || typeof text !== 'string')) throw new Error('Backup notes are invalid.');
    if (!isValidImportedSettings(value.settings)) throw new Error('Backup settings are invalid.');
    if (!isRecord(value.sectionStates)) throw new Error('Backup section state is invalid.');
    return value as unknown as BackupBundle;
};

export class BackupService {
    constructor(private readonly stateManager: StateManager, private readonly dbService: DBService, private readonly userData: UserDataService) {}

    createBundle(): BackupBundle {
        const state = this.stateManager.getState();
        return {
            format: 'dnd5e-quickref-backup', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), appVersion: CONFIG.APP_VERSION,
            settings: { locale: state.settings.locale, use2024Rules: state.settings.use2024Rules, theme: state.settings.theme, density: state.settings.density, darkMode: state.settings.darkMode, reduceMotion: state.settings.reduceMotion },
            favorites: [...state.user.favorites], notes: Object.fromEntries(state.user.notes), sectionStates: this.#readSectionStates(),
        };
    }

    preview(value: unknown): BackupPreview {
        const bundle = validateBackupBundle(value);
        const known = this.stateManager.getState().data.ruleMap;
        const unresolved = [...new Set([...bundle.favorites, ...Object.keys(bundle.notes)].filter((id) => !known.has(id)))];
        return { favorites: bundle.favorites.length, notes: Object.keys(bundle.notes).length, sections: Object.keys(bundle.sectionStates).length, unresolved };
    }

    async apply(value: unknown, mode: 'merge' | 'replace'): Promise<BackupPreview> {
        const bundle = validateBackupBundle(value);
        const preview = this.preview(bundle);
        const state = this.stateManager.getState();
        const oldFavorites = [...state.user.favorites];
        const oldNotes = new Map(state.user.notes);
        const oldSettings = { ...state.settings };
        const storage = typeof localStorage === 'undefined' ? null : localStorage;
        const oldSectionStates = storage?.getItem(CONFIG.STORAGE_KEYS.SECTION_STATES) ?? null;
        const affectedIds = mode === 'replace'
            ? new Set([...oldNotes.keys(), ...Object.keys(bundle.notes)])
            : new Set(Object.keys(bundle.notes));
        try {
            const favorites = mode === 'replace' ? bundle.favorites : [...new Set([...oldFavorites, ...bundle.favorites])];
            const notes = mode === 'replace' ? bundle.notes : { ...Object.fromEntries(oldNotes), ...bundle.notes };
            state.user.favorites = new Set(favorites);
            state.user.notes = new Map(Object.entries(notes));
            for (const [id, text] of Object.entries(notes)) await this.dbService.put(id, text);
            if (mode === 'replace') for (const id of oldNotes.keys()) if (!(id in notes)) await this.dbService.delete(id);
            this.userData.applyImportedSettings(bundle.settings);
            const sectionStates = mode === 'replace'
                ? bundle.sectionStates
                : { ...this.#readSectionStates(), ...bundle.sectionStates };
            storage?.setItem(CONFIG.STORAGE_KEYS.SECTION_STATES, JSON.stringify(sectionStates));
            this.stateManager.publish('favoritesChanged');
            return preview;
        } catch (error) {
            state.user.favorites = new Set(oldFavorites);
            state.user.notes = oldNotes;
            state.settings = oldSettings;
            if (storage) {
                if (oldSectionStates === null) storage.removeItem(CONFIG.STORAGE_KEYS.SECTION_STATES);
                else storage.setItem(CONFIG.STORAGE_KEYS.SECTION_STATES, oldSectionStates);
            }
            for (const id of affectedIds) {
                const old = oldNotes.get(id);
                try { if (old === undefined) await this.dbService.delete(id); else await this.dbService.put(id, old); } catch { /* preserve original failure */ }
            }
            throw error;
        }
    }

    #readSectionStates(): Record<string, boolean> {
        if (typeof localStorage === 'undefined') return {};
        try {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SECTION_STATES);
            const parsed: unknown = raw ? JSON.parse(raw) : {};
            if (!isRecord(parsed)) return {};
            return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
        } catch { return {}; }
    }
}
