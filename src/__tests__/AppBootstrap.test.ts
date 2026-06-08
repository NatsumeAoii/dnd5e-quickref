// @vitest-environment jsdom
/**
 * Integration tests for the application bootstrap sequence.
 * Verifies that the composition root wires services correctly, that settings
 * initialize from storage, that data loading + rule map building work end-to-end,
 * and that cross-service communication via StateManager events functions correctly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config.js';
import { StateManager } from '../state/StateManager.js';
import { SettingsService } from '../services/SettingsService.js';
import { DataService } from '../services/DataService.js';
import { UserDataService } from '../services/UserDataService.js';
import { PersistenceService } from '../services/PersistenceService.js';
import { SyncService } from '../services/SyncService.js';
import { ErrorService } from '../services/ErrorService.js';

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

describe('Application Bootstrap — Settings Integration', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('initializes settings from localStorage and publishes changes correctly', () => {
        const storage = createStorage({
            [CONFIG.STORAGE_KEYS.RULES_2024]: 'true',
            [CONFIG.STORAGE_KEYS.OPTIONAL]: 'true',
            [CONFIG.STORAGE_KEYS.LOCALE]: 'fr_FR',
            [CONFIG.STORAGE_KEYS.THEME]: 'nord',
            [CONFIG.STORAGE_KEYS.DENSITY]: 'compact',
        });
        const stateManager = new StateManager();
        const sync = { broadcast: vi.fn() };
        const optimizer = { shouldReduceMotion: vi.fn(() => false) };
        const settings = new SettingsService(storage, stateManager, sync as never, optimizer as never);

        settings.initialize();

        const state = stateManager.getState();
        expect(state.settings.use2024Rules).toBe(true);
        expect(state.settings.showOptional).toBe(true);
        expect(state.settings.locale).toBe('fr_FR');
        expect(state.settings.theme).toBe('nord');
        expect(state.settings.density).toBe('compact');
    });

    it('propagates setting changes through StateManager to all subscribers', () => {
        const storage = createStorage();
        const stateManager = new StateManager();
        const sync = { broadcast: vi.fn() };
        const optimizer = { shouldReduceMotion: vi.fn(() => false) };
        const settings = new SettingsService(storage, stateManager, sync as never, optimizer as never);
        settings.initialize();

        const received: unknown[] = [];
        stateManager.subscribe('settingChanged', (data) => { received.push(data); });

        settings.update(CONFIG.STORAGE_KEYS.OPTIONAL, true);
        settings.update(CONFIG.STORAGE_KEYS.MODE, true);

        expect(received).toHaveLength(2);
        expect(received[0]).toEqual({ key: 'OPTIONAL', value: true });
        expect(received[1]).toEqual({ key: 'MODE', value: true });
        expect(sync.broadcast).toHaveBeenCalledTimes(2);
    });
});

describe('Application Bootstrap — DataService Integration', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds rule map from loaded data with correct IDs and section mapping', async () => {
        const stateManager = new StateManager();
        stateManager.getState().settings.use2024Rules = false;
        stateManager.getState().settings.locale = 'en_US';
        const dataService = new DataService(stateManager);

        const mockRules = [
            { title: 'Dash', optional: 'Standard rule', icon: 'sprint', subtitle: 'Double movement' },
            { title: 'Dodge', optional: 'Standard rule', icon: 'shield', subtitle: 'Impose disadvantage' },
        ];

        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mockRules,
        } as Response);

        await dataService.ensureSectionDataLoaded('action');
        dataService.buildRuleMap();

        const ruleMap = stateManager.getState().data.ruleMap;
        expect(ruleMap.has('Action::Dash')).toBe(true);
        expect(ruleMap.has('Action::Dodge')).toBe(true);
        expect(ruleMap.get('Action::Dash')?.sectionId).toBe('basic-actions');
        expect(ruleMap.get('Action::Dash')?.type).toBe('Action');
        expect(ruleMap.get('Action::Dash')?.ruleData.subtitle).toBe('Double movement');
    });

    it('rejects malicious data during validation', async () => {
        const stateManager = new StateManager();
        stateManager.getState().settings.use2024Rules = false;
        stateManager.getState().settings.locale = 'en_US';
        const dataService = new DataService(stateManager);

        const mixedRules = [
            { title: 'Good Rule', optional: 'Standard rule', icon: 'book' },
            { title: 'Evil Rule', optional: 'Standard rule', icon: 'skull', description: '<script>steal()</script>' },
            { title: 'Also Good', optional: 'Standard rule', icon: 'scroll' },
        ];

        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mixedRules,
        } as Response);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await dataService.ensureSectionDataLoaded('action');
        dataService.buildRuleMap();

        const ruleMap = stateManager.getState().data.ruleMap;
        expect(ruleMap.has('Action::Good Rule')).toBe(true);
        expect(ruleMap.has('Action::Also Good')).toBe(true);
        expect(ruleMap.has('Action::Evil Rule')).toBe(false);
    });

    it('handles fetch failure gracefully with retry', async () => {
        const stateManager = new StateManager();
        stateManager.getState().settings.use2024Rules = false;
        stateManager.getState().settings.locale = 'en_US';
        const dataService = new DataService(stateManager);

        let callCount = 0;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            callCount++;
            if (callCount <= 2) {
                return { ok: false, status: 503, headers: new Headers() } as Response;
            }
            return {
                ok: true,
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => [{ title: 'Recovered Rule', optional: 'Standard rule', icon: 'test' }],
            } as Response;
        });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await dataService.ensureSectionDataLoaded('action');
        dataService.buildRuleMap();

        expect(callCount).toBe(3);
        expect(stateManager.getState().data.ruleMap.has('Action::Recovered Rule')).toBe(true);
    });
});

describe('Application Bootstrap — Cross-Service Event Flow', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('SyncService broadcasts and receives state changes across the event bus', () => {
        const stateManager = new StateManager();
        // SyncService uses BroadcastChannel — mock it with a proper constructor
        let capturedOnMessage: ((e: MessageEvent) => void) | null = null;
        const mockPostMessage = vi.fn();
        function MockBroadcastChannel() {
            return {
                postMessage: mockPostMessage,
                close: vi.fn(),
                set onmessage(fn: ((e: MessageEvent) => void) | null) { capturedOnMessage = fn; },
                get onmessage() { return capturedOnMessage; },
                onmessageerror: null,
            };
        }
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

        const sync = new SyncService(stateManager);
        const received: unknown[] = [];
        stateManager.subscribe('externalStateChange', (data) => { received.push(data); });

        // Simulate incoming message from another tab
        capturedOnMessage!({ data: { type: 'SETTING_CHANGE', payload: { key: 'OPTIONAL', value: true }, version: CONFIG.APP_VERSION } } as MessageEvent);

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual({ type: 'SETTING_CHANGE', payload: { key: 'OPTIONAL', value: true } });

        // Verify outbound broadcast
        sync.broadcast('FAVORITE_TOGGLE', { id: 'Action::Dash' });
        expect(mockPostMessage).toHaveBeenCalledWith({
            type: 'FAVORITE_TOGGLE',
            payload: { id: 'Action::Dash' },
            version: CONFIG.APP_VERSION,
        });

        vi.unstubAllGlobals();
    });

    it('SyncService ignores messages from different app versions', () => {
        const stateManager = new StateManager();
        let capturedOnMessage: ((e: MessageEvent) => void) | null = null;
        function MockBroadcastChannel() {
            return {
                postMessage: vi.fn(),
                close: vi.fn(),
                set onmessage(fn: ((e: MessageEvent) => void) | null) { capturedOnMessage = fn; },
                get onmessage() { return capturedOnMessage; },
                onmessageerror: null,
            };
        }
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

        new SyncService(stateManager);
        const received: unknown[] = [];
        stateManager.subscribe('externalStateChange', (data) => { received.push(data); });

        capturedOnMessage!({ data: { type: 'SETTING_CHANGE', payload: {}, version: '0.0.1' } } as MessageEvent);

        expect(received).toHaveLength(0);
        vi.unstubAllGlobals();
    });
});

describe('Application Bootstrap — PersistenceService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sanitizes and restores popup state from session storage', () => {
        const saved = JSON.stringify({
            activeZIndex: 1005,
            openPopups: [
                { id: 'Action::Dash', top: '100px', left: '200px', zIndex: '1001' },
                { id: 'Condition::Prone', top: '150px', left: '250px', zIndex: '1002', width: '400px', height: '300px' },
                { id: '', top: '0px', left: '0px' }, // invalid — empty id
                { id: 'A'.repeat(300) }, // invalid — too long
            ],
        });
        const storage = createStorage({ [CONFIG.SESSION_STORAGE_KEYS.UI_SESSION]: saved });
        const stateManager = new StateManager();
        const persistence = new PersistenceService(storage, stateManager);

        const restored = persistence.loadSession();

        expect(restored).toHaveLength(2);
        expect(restored[0].id).toBe('Action::Dash');
        expect(restored[0].top).toBe('100px');
        expect(restored[0].left).toBe('200px');
        expect(restored[1].id).toBe('Condition::Prone');
        expect(restored[1].width).toBe('400px');
        expect(stateManager.getState().ui.activeZIndex).toBe(1005);
    });

    it('handles corrupted session storage gracefully', () => {
        const storage = createStorage({ [CONFIG.SESSION_STORAGE_KEYS.UI_SESSION]: 'not valid json' });
        const stateManager = new StateManager();
        const persistence = new PersistenceService(storage, stateManager);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const restored = persistence.loadSession();

        expect(restored).toEqual([]);
    });
});

describe('Application Bootstrap — ErrorService Integration', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('routes errors through notifier and maintains internal log', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const errorService = new ErrorService();
        const notifications: string[] = [];
        errorService.setNotifier((msg) => { notifications.push(msg); });

        errorService.report(new Error('DB connection failed'), 'UserDataService', 'error');
        errorService.report(new Error('Critical failure'), 'Application.start', 'fatal');

        expect(errorService.getLog()).toHaveLength(2);
        expect(notifications).toHaveLength(2);
        // User-facing messages should be safe (no internal details)
        expect(notifications[0]).not.toContain('DB connection');
        expect(notifications[1]).toContain('critical');
    });

    it('formats error log for issue reports', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const errorService = new ErrorService();

        errorService.report(new Error('fetch timeout'), 'DataService', 'error');
        errorService.warn('Stale cache detected', 'ServiceWorker');

        const report = errorService.formatForReport();
        expect(report).toContain('[ERROR]');
        expect(report).toContain('[WARN]');
        expect(report).toContain('[DataService]');
        expect(report).toContain('fetch timeout');
    });
});

describe('Application Bootstrap — UserDataService Favorites', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('toggles favorites and notifies via StateManager', () => {
        const storage = createStorage({ [CONFIG.STORAGE_KEYS.FAVORITES]: '["Action::Dash"]' });
        const stateManager = new StateManager();
        const db = { getAll: vi.fn(async () => ({})), put: vi.fn(), delete: vi.fn() } as never;
        const sync = { broadcast: vi.fn() };
        const service = new UserDataService(storage, stateManager, db, sync as never);

        // Initialize loads favorites from storage
        stateManager.getState().user.favorites = new Set(['Action::Dash']);

        const events: unknown[] = [];
        stateManager.subscribe('favoritesChanged', () => { events.push(true); });

        // Toggle off
        service.toggleFavorite('Action::Dash');
        expect(stateManager.getState().user.favorites.has('Action::Dash')).toBe(false);
        expect(events).toHaveLength(1);

        // Toggle on
        service.toggleFavorite('Action::Dodge');
        expect(stateManager.getState().user.favorites.has('Action::Dodge')).toBe(true);
        expect(events).toHaveLength(2);
        expect(sync.broadcast).toHaveBeenCalledTimes(2);
    });
});
