export class DBService {
    #dbName = 'dnd5e_quickref_db';
    #storeName = 'user_notes';
    #version = 1;
    #db: IDBDatabase | null = null;
    #unavailable = false;
    #fallbackStore = new Map<string, string>();

    async open(): Promise<IDBDatabase> {
        if (this.#db) return this.#db;
        if (this.#unavailable) throw new Error('IndexedDB is not available in this environment.');
        return new Promise((resolve, reject) => {
            let req: IDBOpenDBRequest;
            try {
                req = indexedDB.open(this.#dbName, this.#version);
            } catch {
                // #24: IndexedDB unavailable (e.g., Firefox private browsing pre-v115)
                this.#unavailable = true;
                reject(new Error('IndexedDB is not available in this environment.'));
                return;
            }
            req.onupgradeneeded = (e) => {
                const db = (e.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.#storeName)) {
                    db.createObjectStore(this.#storeName);
                }
            };
            req.onsuccess = (e) => {
                this.#db = (e.target as IDBOpenDBRequest).result;
                // (C) Auto-close stale connection when another tab upgrades schema
                this.#db.onversionchange = () => {
                    this.#db?.close();
                    this.#db = null;
                };
                resolve(this.#db);
            };
            req.onblocked = () => reject(new Error('IndexedDB open blocked — close other tabs using this app and retry.'));
            req.onerror = () => reject(req.error);
        });
    }

    async getAll(): Promise<Record<string, string>> {
        if (this.#unavailable) return Object.fromEntries(this.#fallbackStore);
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.#storeName, 'readonly');
            const store = tx.objectStore(this.#storeName);
            const req = store.openCursor();
            const results: Record<string, string> = {};
            const fail = (): void => reject(tx.error ?? req.error ?? new Error('IndexedDB read transaction failed'));
            req.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
                if (cursor) {
                    results[cursor.key as string] = cursor.value;
                    cursor.continue();
                }
            };
            req.onerror = fail;
            tx.onerror = fail;
            tx.onabort = fail;
            tx.oncomplete = () => resolve(results);
        });
    }

    async put(key: string, value: string): Promise<void> {
        if (this.#unavailable) { this.#fallbackStore.set(key, value); return; }
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.#storeName, 'readwrite');
            const store = tx.objectStore(this.#storeName);
            const req = store.put(value, key);
            const fail = (): void => reject(tx.error ?? req.error ?? new Error('IndexedDB write transaction failed'));
            req.onerror = fail;
            tx.onerror = fail;
            tx.onabort = fail;
            tx.oncomplete = () => resolve();
        });
    }

    async delete(key: string): Promise<void> {
        if (this.#unavailable) { this.#fallbackStore.delete(key); return; }
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.#storeName, 'readwrite');
            const store = tx.objectStore(this.#storeName);
            const req = store.delete(key);
            const fail = (): void => reject(tx.error ?? req.error ?? new Error('IndexedDB delete transaction failed'));
            req.onerror = fail;
            tx.onerror = fail;
            tx.onabort = fail;
            tx.oncomplete = () => resolve();
        });
    }
}
