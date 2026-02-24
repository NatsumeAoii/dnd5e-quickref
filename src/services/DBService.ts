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

    async getAll(): Promise<Record<string, string>> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.#storeName, 'readonly');
            const store = tx.objectStore(this.#storeName);
            const req = store.openCursor();
            const results: Record<string, string> = {};
            req.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
                if (cursor) {
                    results[cursor.key as string] = cursor.value;
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    async put(key: string, value: string): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.#storeName, 'readwrite');
            const store = tx.objectStore(this.#storeName);
            const req = store.put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
}
