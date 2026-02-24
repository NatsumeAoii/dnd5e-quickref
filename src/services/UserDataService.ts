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
        const fileName = `quickref-notes-${new Date().toISOString().split('T')[0]}.json.gz`;

        // #20: Try Web Share API for mobile (Safari iOS <a>.click() silently fails)
        const file = new File([blob], fileName, { type: 'application/gzip' });
        if (navigator.canShare?.({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'QuickRef Notes Export' });
                return;
            } catch { /* User cancelled or share failed — fall through to download */ }
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }

    // (D) Removed `g` flag: `g` + `test()` causes lastIndex drift across calls on a static regex
    static #DANGEROUS_PATTERN = /<script[\s>]|javascript:|on\w+\s*=/i;
    static #KEY_PATTERN = /^[\w\s]+::[\w\s\-'(),/]+$/;

    #sanitizeNoteText(text: string): string {
        return text.replace(UserDataService.#DANGEROUS_PATTERN, '');
    }

    #validateNoteKey(key: string): boolean {
        return UserDataService.#KEY_PATTERN.test(key) && key.length < 200;
    }

    async importNotes(file: File): Promise<number> {
        if (file.size > CONFIG.IMPORT_LIMITS.MAX_FILE_SIZE_BYTES) {
            throw new Error(`File exceeds maximum size of ${(CONFIG.IMPORT_LIMITS.MAX_FILE_SIZE_BYTES / 1_048_576).toFixed(1)}MB`);
        }

        let jsonString: string;
        const maxDecompressedSize = CONFIG.IMPORT_LIMITS.MAX_FILE_SIZE_BYTES * 10; // 50MB decompressed limit

        if (file.name.endsWith('.gz')) {
            // #14: Streaming size check to defend against zip bombs
            let totalBytes = 0;
            const sizeGuard = new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                    totalBytes += chunk.byteLength;
                    if (totalBytes > maxDecompressedSize) {
                        controller.error(new Error(`Decompressed data exceeds ${(maxDecompressedSize / 1_048_576).toFixed(0)}MB safety limit`));
                        return;
                    }
                    controller.enqueue(chunk);
                },
            });
            const stream = file.stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(sizeGuard);
            jsonString = await new Response(stream).text();
        } else {
            jsonString = await file.text();
        }

        let imported: unknown;
        try { imported = JSON.parse(jsonString); } catch { throw new Error('Invalid JSON format'); }
        if (typeof imported !== 'object' || imported === null || Array.isArray(imported)) throw new Error('Notes must be a JSON object');

        const entries = Object.entries(imported as Record<string, unknown>);
        if (entries.length > CONFIG.IMPORT_LIMITS.MAX_NOTES) {
            throw new Error(`Import exceeds maximum of ${CONFIG.IMPORT_LIMITS.MAX_NOTES} notes (found ${entries.length})`);
        }

        const state = this.#stateManager.getState();
        const toWrite: [string, string][] = [];
        let skipped = 0;
        const encoder = new TextEncoder();

        for (const [key, value] of entries) {
            if (typeof value !== 'string') { skipped++; continue; }
            if (!this.#validateNoteKey(key)) { skipped++; continue; }

            if (encoder.encode(value).byteLength > CONFIG.IMPORT_LIMITS.MAX_NOTE_SIZE_BYTES) { skipped++; continue; }

            const sanitized = this.#sanitizeNoteText(value);
            const existing = state.user.notes.get(key);

            if (!existing || existing.trim() === '') {
                state.user.notes.set(key, sanitized);
                toWrite.push([key, sanitized]);
            }
        }

        // Batch DB writes
        for (const [key, text] of toWrite) {
            await this.#dbService.put(key, text);
        }

        if (skipped > 0) console.warn(`Import: skipped ${skipped} invalid entries`);
        return toWrite.length;
    }
}
