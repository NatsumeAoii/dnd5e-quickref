import { CONFIG } from '../config.js';
import type { StateManager } from '../state/StateManager.js';
import type { DBService } from './DBService.js';
import type { SyncService } from './SyncService.js';

export class UserDataService {
    #storage: Storage;
    #stateManager: StateManager;
    #dbService: DBService;
    #syncService: SyncService;

    constructor(storage: Storage, stateManager: StateManager, dbService: DBService, syncService: SyncService) {
        this.#storage = storage;
        this.#stateManager = stateManager;
        this.#dbService = dbService;
        this.#syncService = syncService;
    }

    #load = (key: string, def: unknown): unknown => {
        try { const val = this.#storage.getItem(key); return val ? JSON.parse(val) : def; } catch (e) { console.error(`Failed to parse user data for "${key}":`, e); return def; }
    };

    async initialize(): Promise<void> {
        const state = this.#stateManager.getState();
        state.user.favorites = new Set(this.#load(CONFIG.STORAGE_KEYS.FAVORITES, []) as string[]);

        try {
            const notes = await this.#dbService.getAll();
            state.user.notes = new Map(Object.entries(notes));

            const legacyNotes = this.#load(CONFIG.STORAGE_KEYS.NOTES, null) as Record<string, string> | null;
            if (legacyNotes) {
                for (const [k, v] of Object.entries(legacyNotes)) {
                    if (!state.user.notes.has(k)) {
                        state.user.notes.set(k, v);
                        await this.#dbService.put(k, v);
                    }
                }
                this.#storage.removeItem(CONFIG.STORAGE_KEYS.NOTES);
            }
        } catch (e) {
            console.error('DB Init failed', e);
        }
    }

    toggleFavorite(id: string, broadcast = true): void {
        const state = this.#stateManager.getState();
        if (state.user.favorites.has(id)) {
            state.user.favorites.delete(id);
        } else {
            state.user.favorites.add(id);
        }
        this.#storage.setItem(CONFIG.STORAGE_KEYS.FAVORITES, JSON.stringify([...state.user.favorites]));
        this.#stateManager.publish('favoritesChanged');
        if (broadcast) this.#syncService.broadcast('FAVORITE_TOGGLE', { id });
    }

    updateFavoritesOrder(newOrderArray: string[]): void {
        const state = this.#stateManager.getState();
        state.user.favorites = new Set(newOrderArray);
        this.#storage.setItem(CONFIG.STORAGE_KEYS.FAVORITES, JSON.stringify(newOrderArray));
    }

    isFavorite = (id: string): boolean => this.#stateManager.getState().user.favorites.has(id);

    saveNote(id: string, text: string, broadcast = true): void {
        const state = this.#stateManager.getState();
        state.user.notes.set(id, text);
        this.#dbService.put(id, text).catch((e) => console.error('Save note failed', e));
        if (broadcast) this.#syncService.broadcast('NOTE_UPDATE', { id, text });
    }

    getNote = (id: string): string => this.#stateManager.getState().user.notes.get(id) || '';

    async exportNotes(): Promise<void> {
        const notes = Object.fromEntries(this.#stateManager.getState().user.notes);
        const jsonString = JSON.stringify(notes);

        const stream = new Blob([jsonString]).stream();
        const compressedReadableStream = stream.pipeThrough(new CompressionStream('gzip'));
        const compressedResponse = await new Response(compressedReadableStream);
        const blob = await compressedResponse.blob();

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `quickref-notes-${new Date().toISOString().split('T')[0]}.json.gz`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async importNotes(file: File): Promise<number> {
        let jsonString: string;

        if (file.name.endsWith('.gz')) {
            const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
            const response = new Response(stream);
            jsonString = await response.text();
        } else {
            jsonString = await file.text();
        }

        const imported = JSON.parse(jsonString) as Record<string, string>;
        if (typeof imported !== 'object' || imported === null) throw new Error('Invalid notes format');

        const state = this.#stateManager.getState();
        let count = 0;

        for (const [id, text] of Object.entries(imported)) {
            if (typeof text !== 'string') continue;
            const existing = state.user.notes.get(id);
            if (!existing || existing.trim() === '') {
                state.user.notes.set(id, text);
                await this.#dbService.put(id, text);
                count++;
            }
        }

        return count;
    }
}
