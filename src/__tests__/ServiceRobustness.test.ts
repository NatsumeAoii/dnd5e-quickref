// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config.js';
import { StateManager } from '../state/StateManager.js';
import { A11yService } from '../services/A11yService.js';
import { DBService } from '../services/DBService.js';
import { ErrorService } from '../services/ErrorService.js';
import { GamepadService } from '../services/GamepadService.js';
import { PerformanceOptimizer } from '../services/PerformanceOptimizer.js';
import { ServiceWorkerMessenger } from '../services/ServiceWorkerMessenger.js';
import { SettingsService } from '../services/SettingsService.js';
import { UserDataService } from '../services/UserDataService.js';
import { WakeLockService } from '../services/WakeLockService.js';

const createStorage = (initial: Record<string, string> = {}): Storage => {
    const data = new Map(Object.entries(initial));
    return {
        get length() { return data.size; },
        clear: vi.fn(() => data.clear()),
        getItem: vi.fn((key: string) => data.get(key) ?? null),
        key: vi.fn((index: number) => Array.from(data.keys())[index] ?? null),
        removeItem: vi.fn((key: string) => { data.delete(key); }),
        setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    };
};

const createSettingsService = (storage = createStorage()) => {
    const stateManager = new StateManager();
    const sync = { broadcast: vi.fn() };
    const optimizer = { shouldReduceMotion: vi.fn(() => false) };
    const service = new SettingsService(storage, stateManager, sync as never, optimizer as never);
    service.initialize();
    return { service, stateManager, sync, storage };
};

describe('SettingsService update guards', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('ignores invalid setting value types', () => {
        const { service, stateManager, sync, storage } = createSettingsService();
        const published = vi.fn();
        stateManager.subscribe('settingChanged', published);

        service.update(CONFIG.STORAGE_KEYS.OPTIONAL, 'true');

        expect(stateManager.getState().settings.showOptional).toBe(false);
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(published).not.toHaveBeenCalled();
        expect(sync.broadcast).not.toHaveBeenCalled();
    });

    it('does not publish or persist unchanged setting values', () => {
        const { service, stateManager, sync, storage } = createSettingsService(createStorage({ [CONFIG.STORAGE_KEYS.OPTIONAL]: 'true' }));
        const published = vi.fn();
        stateManager.subscribe('settingChanged', published);

        service.update(CONFIG.STORAGE_KEYS.OPTIONAL, true);

        expect(storage.setItem).not.toHaveBeenCalled();
        expect(published).not.toHaveBeenCalled();
        expect(sync.broadcast).not.toHaveBeenCalled();
    });

    it('keeps the current-session setting update when storage rejects writes', () => {
        const storage = createStorage();
        vi.mocked(storage.setItem).mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
        const { service, stateManager, sync } = createSettingsService(storage);
        const published = vi.fn();
        stateManager.subscribe('settingChanged', published);

        expect(() => service.update(CONFIG.STORAGE_KEYS.OPTIONAL, true)).not.toThrow();
        expect(stateManager.getState().settings.showOptional).toBe(true);
        expect(published).toHaveBeenCalledWith({ key: 'OPTIONAL', value: true });
        expect(sync.broadcast).toHaveBeenCalledWith('SETTING_CHANGE', { key: 'OPTIONAL', value: true });
    });

    it('falls back from unsafe stored theme and density values', () => {
        const { stateManager } = createSettingsService(createStorage({
            [CONFIG.STORAGE_KEYS.THEME]: '../outside',
            [CONFIG.STORAGE_KEYS.DENSITY]: 'giant',
        }));

        expect(stateManager.getState().settings.theme).toBe(CONFIG.DEFAULTS.THEME);
        expect(stateManager.getState().settings.density).toBe('normal');
    });

    it('ignores invalid density updates instead of persisting arbitrary dataset values', () => {
        const { service, stateManager, sync, storage } = createSettingsService();

        service.update(CONFIG.STORAGE_KEYS.DENSITY, 'giant');

        expect(stateManager.getState().settings.density).toBe('normal');
        expect(storage.setItem).not.toHaveBeenCalledWith(CONFIG.STORAGE_KEYS.DENSITY, 'giant');
        expect(sync.broadcast).not.toHaveBeenCalledWith('SETTING_CHANGE', { key: 'DENSITY', value: 'giant' });
    });

    it('falls back from unsupported stored locales and persists supported locale updates', () => {
        const { service, stateManager, sync, storage } = createSettingsService(createStorage({
            [CONFIG.STORAGE_KEYS.LOCALE]: '../id_ID',
        }));

        expect(stateManager.getState().settings.locale).toBe(CONFIG.DEFAULTS.LOCALE);

        service.update(CONFIG.STORAGE_KEYS.LOCALE, 'id_ID');

        expect(stateManager.getState().settings.locale).toBe('id_ID');
        expect(storage.setItem).toHaveBeenCalledWith(CONFIG.STORAGE_KEYS.LOCALE, 'id_ID');
        expect(sync.broadcast).toHaveBeenCalledWith('SETTING_CHANGE', { key: 'LOCALE', value: 'id_ID' });
    });
});

describe('DBService transaction semantics', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('does not resolve writes until the IndexedDB transaction completes', async () => {
        let openReq: Record<string, unknown>;
        let putReq: Record<string, unknown> | undefined;
        const tx = {
            error: new DOMException('transaction aborted', 'AbortError'),
            objectStore: vi.fn(() => ({
                put: vi.fn(() => {
                    putReq = {};
                    return putReq;
                }),
            })),
        } as Record<string, unknown>;
        const db = {
            objectStoreNames: { contains: vi.fn(() => true) },
            transaction: vi.fn(() => tx),
            close: vi.fn(),
        };
        vi.stubGlobal('indexedDB', {
            open: vi.fn(() => {
                openReq = {};
                queueMicrotask(() => {
                    openReq.result = db;
                    (openReq.onsuccess as ((event: Event) => void) | undefined)?.({ target: openReq } as unknown as Event);
                });
                return openReq;
            }),
        });
        const service = new DBService();
        const write = service.put('Action::Dash', 'note');

        for (let i = 0; i < 5 && !putReq; i++) await Promise.resolve();
        expect(putReq).toBeDefined();
        let settled = false;
        write.then(() => { settled = true; }, () => { settled = true; });
        (putReq!.onsuccess as (() => void) | undefined)?.();
        await Promise.resolve();

        expect(settled).toBe(false);
        (tx.onabort as (() => void) | undefined)?.();
        await expect(write).rejects.toThrow('transaction aborted');
    });
});

describe('ServiceWorkerMessenger resilience', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('returns false when service worker readiness times out', async () => {
        vi.useFakeTimers();
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                ready: new Promise(() => undefined),
                controller: null,
                addEventListener: vi.fn(),
            },
        });

        const ready = ServiceWorkerMessenger.ensureServiceWorkerReady(50);
        await vi.advanceTimersByTimeAsync(51);

        await expect(ready).resolves.toBe(false);
    });

    it('does not throw when controller postMessage fails', () => {
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                controller: { postMessage: vi.fn(() => { throw new DOMException('clone failed', 'DataCloneError'); }) },
            },
        });

        expect(ServiceWorkerMessenger.setCachingPolicy(true)).toBe(false);
        expect(ServiceWorkerMessenger.clearCache()).toBe(false);
    });
});

describe('WakeLockService lifecycle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('clears released wake-lock sentinels so they are not released twice', async () => {
        const sentinel = new EventTarget() as WakeLockSentinel;
        Object.assign(sentinel, { released: false, type: 'screen', release: vi.fn(async () => undefined) });
        Object.defineProperty(navigator, 'wakeLock', {
            configurable: true,
            value: { request: vi.fn(async () => sentinel) },
        });
        const service = new WakeLockService();

        service.setEnabled(true);
        await Promise.resolve();
        sentinel.dispatchEvent(new Event('release'));
        service.setEnabled(false);
        await Promise.resolve();

        expect(sentinel.release).not.toHaveBeenCalled();
    });
});

describe('A11yService announcements', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('clears live region before setting repeated messages', () => {
        document.body.innerHTML = `<div id="${CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER}">Saved</div>`;
        let frame: FrameRequestCallback = () => undefined;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
            frame = callback;
            return 1;
        });
        const service = new A11yService({ get: (id: string) => document.getElementById(id) as HTMLElement } as never);
        const announcer = document.getElementById(CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER) as HTMLElement;

        service.announce('Saved');
        expect(announcer.textContent).toBe('');
        frame(0);
        expect(announcer.textContent).toBe('Saved');
    });
});

describe('ErrorService user-facing notifications', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('logs diagnostics but sends user-safe error notification text', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const notify = vi.fn();
        const service = new ErrorService();
        service.setNotifier(notify);

        service.report(new Error('Database password token leaked'), 'SaveNote');

        expect(service.getLastError()?.message).toBe('Database password token leaked');
        expect(notify.mock.calls[0]?.[0]).not.toContain('Database password');
        expect(notify.mock.calls[0]?.[0]).toContain('Something went wrong');
    });
});

describe('GamepadService lifecycle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('can cancel active polling when destroyed', () => {
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: vi.fn(() => []) });
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 77);
        const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        const service = new GamepadService({ queryAll: vi.fn(() => []), get: vi.fn() } as never);

        window.dispatchEvent(new Event('gamepadconnected'));
        service.destroy();

        expect(raf).toHaveBeenCalled();
        expect(caf).toHaveBeenCalledWith(77);
    });
});

describe('PerformanceOptimizer network changes', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('updates reduced-motion preference when connection saveData changes', () => {
        const connection = new EventTarget() as EventTarget & { saveData?: boolean; effectiveType?: string };
        connection.saveData = false;
        connection.effectiveType = '4g';
        Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
        const optimizer = new PerformanceOptimizer();

        expect(optimizer.shouldReduceMotion()).toBe(false);
        connection.saveData = true;
        connection.dispatchEvent(new Event('change'));

        expect(optimizer.shouldReduceMotion()).toBe(true);
    });
});

describe('UserDataService compressed note import', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('returns a safe error when compressed import is unsupported', async () => {
        vi.stubGlobal('DecompressionStream', undefined);
        const service = new UserDataService(
            createStorage(),
            new StateManager(),
            { getAll: vi.fn(async () => ({})), put: vi.fn(), delete: vi.fn() } as never,
            { broadcast: vi.fn() } as never,
        );
        const file = new File([new Uint8Array([1, 2, 3])], 'notes.json.gz');

        await expect(service.importNotes(file)).rejects.toThrow('Compressed note imports are not supported');
    });
});

describe('UserDataService persistence failure handling', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not throw when favorite persistence is rejected by storage', () => {
        const storage = createStorage();
        vi.mocked(storage.setItem).mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
        const stateManager = new StateManager();
        const sync = { broadcast: vi.fn() };
        const service = new UserDataService(
            storage,
            stateManager,
            { getAll: vi.fn(async () => ({})), put: vi.fn(), delete: vi.fn() } as never,
            sync as never,
        );

        expect(() => service.toggleFavorite('Action::Dash')).not.toThrow();
        expect(stateManager.getState().user.favorites.has('Action::Dash')).toBe(true);
        expect(sync.broadcast).toHaveBeenCalledWith('FAVORITE_TOGGLE', { id: 'Action::Dash' });
    });

    it('reports note persistence failures to callers without throwing', async () => {
        const service = new UserDataService(
            createStorage(),
            new StateManager(),
            {
                getAll: vi.fn(async () => ({})),
                put: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }),
                delete: vi.fn(),
            } as never,
            { broadcast: vi.fn() } as never,
        );

        await expect(service.saveNote('Action::Dash', 'note')).resolves.toBe(false);
    });
});
