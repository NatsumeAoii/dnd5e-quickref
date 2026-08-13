import { describe, expect, it, vi } from 'vitest';
import { StorageCapabilityService } from '../services/StorageCapabilityService.js';

describe('StorageCapabilityService', () => {
    it('reports persistent storage when localStorage and IndexedDB are available', () => {
        vi.stubGlobal('indexedDB', {});
        const storage = { setItem: vi.fn(), removeItem: vi.fn() } as never;
        expect(new StorageCapabilityService().detect(storage).capability).toBe('persistent');
        vi.unstubAllGlobals();
    });

    it('reports restricted storage when the probe fails', () => {
        vi.stubGlobal('indexedDB', undefined);
        const storage = { setItem: vi.fn(() => { throw new Error('blocked'); }), removeItem: vi.fn() } as never;
        expect(new StorageCapabilityService().detect(storage).capability).toBe('restricted');
        vi.unstubAllGlobals();
    });
});
