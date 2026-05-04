import { CONFIG } from '../config.js';
import type { StateManager } from '../state/StateManager.js';
import type { DBService } from './DBService.js';
import type { SyncService } from './SyncService.js';

const hasUnsafeNoteKeyChar = (key: string): boolean =>
    [...key].some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || code === 127 || '<>"`'.includes(char);
    });


export class UserDataService {
    #storage: Storage;
    #stateManager: StateManager;
    #dbService: DBService;
    #syncService: SyncService;
    #noteSaveQueues = new Map<string, Promise<boolean>>();

    constructor(storage: Storage, stateManager: StateManager, dbService: DBService, syncService: SyncService) {
        this.#storage = storage;
        this.#stateManager = stateManager;
        this.#dbService = dbService;
        this.#syncService = syncService;
    }

    #load = (key: string, def: unknown): unknown => {
        try { const val = this.#storage.getItem(key); return val ? JSON.parse(val) : def; } catch (e) { console.error(`Failed to parse user data for "${key}":`, e); return def; }
    };

    #asStringArray(value: unknown): string[] {
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    }

    #asStringRecord(value: unknown): Record<string, string> | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const entries = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
        return Object.fromEntries(entries);
    }

    #persistFavorites(ids: string[]): void {
        try {
            this.#storage.setItem(CONFIG.STORAGE_KEYS.FAVORITES, JSON.stringify(ids));
        } catch (e) {
            console.warn('Failed to persist favorites:', e);
        }
    }

    async initialize(): Promise<void> {
        const state = this.#stateManager.getState();
        state.user.favorites = new Set(this.#asStringArray(this.#load(CONFIG.STORAGE_KEYS.FAVORITES, [])));

        try {
            const notes = await this.#dbService.getAll();
            state.user.notes = new Map(Object.entries(notes).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));

            const legacyNotes = this.#asStringRecord(this.#load(CONFIG.STORAGE_KEYS.NOTES, null));
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
        this.#persistFavorites([...state.user.favorites]);
        this.#stateManager.publish('favoritesChanged');
        if (broadcast) this.#syncService.broadcast('FAVORITE_TOGGLE', { id });
    }

    updateFavoritesOrder(newOrderArray: string[]): void {
        const state = this.#stateManager.getState();
        state.user.favorites = new Set(newOrderArray);
        this.#persistFavorites(newOrderArray);
    }

    isFavorite = (id: string): boolean => this.#stateManager.getState().user.favorites.has(id);

    async saveNote(id: string, text: string, broadcast = true): Promise<boolean> {
        const previous = this.#noteSaveQueues.get(id) ?? Promise.resolve(true);
        const current = previous
            .catch(() => false)
            .then(() => this.#saveNoteNow(id, text, broadcast));
        this.#noteSaveQueues.set(id, current);
        current.finally(() => {
            if (this.#noteSaveQueues.get(id) === current) this.#noteSaveQueues.delete(id);
        }).catch(() => undefined);
        return current;
    }

    async #saveNoteNow(id: string, text: string, broadcast = true): Promise<boolean> {
        const state = this.#stateManager.getState();
        const hadPrevious = state.user.notes.has(id);
        const previous = state.user.notes.get(id);
        try {
            if (text.trim() === '') {
                state.user.notes.delete(id);
                await this.#dbService.delete(id);
            } else {
                state.user.notes.set(id, text);
                await this.#dbService.put(id, text);
            }
            if (broadcast) this.#syncService.broadcast('NOTE_UPDATE', { id, text });
            return true;
        } catch (e) {
            if (hadPrevious && previous !== undefined) state.user.notes.set(id, previous);
            else state.user.notes.delete(id);
            console.error(text.trim() === '' ? 'Delete note failed' : 'Save note failed', e);
            return false;
        }
    }

    getNote = (id: string): string => this.#stateManager.getState().user.notes.get(id) || '';

    async #shareOrDownload(blob: Blob, fileName: string, mimeType: string, title: string): Promise<void> {
        const file = new File([blob], fileName, { type: mimeType });
        if (navigator.canShare?.({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title });
                return;
            } catch {
                // User cancelled or share failed; normal download is the fallback.
            }
        }

        let url: string | null = null;
        let anchor: HTMLAnchorElement | null = null;
        try {
            url = URL.createObjectURL(blob);
            anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
        } catch (e) {
            console.error(`${title} failed:`, e);
            throw new Error(`${title} failed`);
        } finally {
            anchor?.remove();
            if (url) URL.revokeObjectURL(url);
        }
    }

    async exportNotes(): Promise<void> {
        const notes = Object.fromEntries(this.#stateManager.getState().user.notes);
        const jsonString = JSON.stringify(notes);
        let blob: Blob;
        let fileName = `quickref-notes-${new Date().toISOString().split('T')[0]}.json`;
        let mimeType = 'application/json';

        if (typeof CompressionStream === 'function' && typeof Blob.prototype.stream === 'function') {
            const stream = new Blob([jsonString]).stream();
            const compressedReadableStream = stream.pipeThrough(new CompressionStream('gzip'));
            const compressedResponse = await new Response(compressedReadableStream);
            blob = await compressedResponse.blob();
            fileName += '.gz';
            mimeType = 'application/gzip';
        } else {
            blob = new Blob([jsonString], { type: mimeType });
        }

        await this.#shareOrDownload(blob, fileName, mimeType, 'QuickRef Notes Export');
    }

    async exportFavorites(): Promise<void> {
        const favorites = [...this.#stateManager.getState().user.favorites];
        const jsonString = JSON.stringify(favorites, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const fileName = `quickref-favorites-${new Date().toISOString().split('T')[0]}.json`;

        await this.#shareOrDownload(blob, fileName, 'application/json', 'QuickRef Favorites Export');
    }

    #validateNoteKey(key: string): boolean {
        if (key.length === 0 || key.length >= 200 || !key.includes('::')) return false;
        if (hasUnsafeNoteKeyChar(key)) return false;
        const separatorIndex = key.indexOf('::');
        const type = key.slice(0, separatorIndex).trim();
        const title = key.slice(separatorIndex + 2).trim();
        return type.length > 0 && title.length > 0;
    }

    async importNotes(file: File): Promise<number> {
        if (file.size > CONFIG.IMPORT_LIMITS.MAX_FILE_SIZE_BYTES) {
            throw new Error(`File exceeds maximum size of ${(CONFIG.IMPORT_LIMITS.MAX_FILE_SIZE_BYTES / 1_048_576).toFixed(1)}MB`);
        }

        let jsonString: string;
        const maxDecompressedSize = CONFIG.IMPORT_LIMITS.MAX_FILE_SIZE_BYTES * 10; // 50MB decompressed limit

        if (file.name.endsWith('.gz')) {
            if (typeof DecompressionStream !== 'function' || typeof file.stream !== 'function') {
                throw new Error('Compressed note imports are not supported in this browser. Import a .json file instead.');
            }
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

            toWrite.push([key, value]);
        }

        const previousValues = new Map<string, string | undefined>();
        for (const [key, text] of toWrite) {
            previousValues.set(key, state.user.notes.get(key));
            state.user.notes.set(key, text);
            try {
                await this.#dbService.put(key, text);
            } catch (error) {
                const previous = previousValues.get(key);
                if (previous === undefined) state.user.notes.delete(key);
                else state.user.notes.set(key, previous);
                throw error;
            }
        }

        if (skipped > 0) console.warn(`Import: skipped ${skipped} invalid entries`);
        return toWrite.length;
    }
}
