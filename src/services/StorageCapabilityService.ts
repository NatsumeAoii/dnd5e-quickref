export type StorageCapability = 'persistent' | 'session-only' | 'local-storage-unavailable' | 'restricted';

export interface StorageCapabilityResult {
    capability: StorageCapability;
    indexedDb: boolean;
    localStorage: boolean;
    message: string;
}

const canUseStorage = (storage: Storage): boolean => {
    try {
        const key = '__quickref_storage_probe__';
        storage.setItem(key, '1');
        storage.removeItem(key);
        return true;
    } catch {
        return false;
    }
};

export class StorageCapabilityService {
    detect(storage: Storage = window.localStorage): StorageCapabilityResult {
        const localStorageAvailable = canUseStorage(storage);
        let indexedDbAvailable = false;
        try { indexedDbAvailable = typeof indexedDB !== 'undefined'; } catch { indexedDbAvailable = false; }

        if (localStorageAvailable && indexedDbAvailable) {
            return { capability: 'persistent', indexedDb: true, localStorage: true, message: 'Local data can be saved on this device.' };
        }
        if (localStorageAvailable) {
            return { capability: 'session-only', indexedDb: false, localStorage: true, message: 'Notes may be session-only in this browser. Export a backup for recovery.' };
        }
        return {
            capability: indexedDbAvailable ? 'local-storage-unavailable' : 'restricted',
            indexedDb: indexedDbAvailable,
            localStorage: false,
            message: 'Browser storage is restricted. Export a backup after important changes.',
        };
    }
}
