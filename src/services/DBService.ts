export class DBService {
    #dbName = 'dnd5e_quickref_db';
    #storeName = 'user_notes';
    #version = 1;
    #db: IDBDatabase | null = null;

    async open(): Promise<IDBDatabase> {
        if (this.#db) return this.#db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.#dbName, this.#version);
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

    // Retry transaction once if the connection was closed by versionchange between open() and transaction()
    async #withTransaction<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const db = await this.open();
            try {
                return await new Promise<T>((resolve, reject) => {
                    const tx = db.transaction(this.#storeName, mode);
                    const req = fn(tx.objectStore(this.#storeName));
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            } catch (e) {
                // InvalidStateError means the connection was closed — force re-open on next attempt
                if (attempt === 0 && e instanceof DOMException && e.name === 'InvalidStateError') {
                    this.#db = null;
                    continue;
                }
                throw e;
            }
        }
        throw new Error('IndexedDB transaction failed after retry');
    }

    async getAll(): Promise<Record<string, string>> {
        const keys = await this.#withTransaction<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
        const values = await this.#withTransaction<string[]>('readonly', (store) => store.getAll());
        const results: Record<string, string> = {};
        for (let i = 0; i < keys.length; i++) {
            results[keys[i] as string] = values[i];
        }
        return results;
    }

    async put(key: string, value: string): Promise<void> {
        await this.#withTransaction('readwrite', (store) => store.put(value, key));
    }

    async delete(key: string): Promise<void> {
        await this.#withTransaction('readwrite', (store) => store.delete(key));
    }
}
