// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config.js';
import { StateManager } from '../state/StateManager.js';
import { DataService } from '../services/DataService.js';
import { LocalizationService } from '../services/LocalizationService.js';
import { ChangelogService } from '../services/ChangelogService.js';
import { KeyboardShortcutsService } from '../services/KeyboardShortcutsService.js';
import { NavigationService } from '../services/NavigationService.js';
import { OnboardingService } from '../services/OnboardingService.js';
import { PersistenceService } from '../services/PersistenceService.js';
import { ReadmeService } from '../services/ReadmeService.js';
import { SyncService } from '../services/SyncService.js';
import { UserDataService } from '../services/UserDataService.js';
import { DragDropManager } from '../ui/DragDropManager.js';
import { TemplateService } from '../ui/TemplateService.js';
import { UIController } from '../ui/UIController.js';
import { ViewRenderer } from '../ui/ViewRenderer.js';
import { WindowManager } from '../ui/WindowManager.js';
import type { AppState } from '../types.js';

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

const createUserDataService = (stateManager = new StateManager(), storage: Storage = createStorage()) => {
    const db = {
        getAll: vi.fn(async () => ({} as Record<string, string>)),
        put: vi.fn(async (_key: string, _value: string) => undefined),
        delete: vi.fn(async (_key: string) => undefined),
    };
    const sync = { broadcast: vi.fn() };
    return {
        service: new UserDataService(storage, stateManager, db as never, sync as never),
        stateManager,
        db,
        sync,
    };
};

const setUrlBlobMocks = () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:quickref-test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
};

describe('UserDataService runtime resilience', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        setUrlBlobMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('ignores malformed stored favorites instead of failing initialization', async () => {
        const storage = createStorage({ [CONFIG.STORAGE_KEYS.FAVORITES]: JSON.stringify({ bad: true }) });
        const { service, stateManager } = createUserDataService(new StateManager(), storage);

        await expect(service.initialize()).resolves.toBeUndefined();
        expect(stateManager.getState().user.favorites.size).toBe(0);
    });

    it('preserves note text literally during import because notes are stored as textarea values', async () => {
        const { service, db } = createUserDataService();
        const noteText = 'keep javascript:alert(1) text onclick=example <script>alert(2)</script> end';
        const file = new File([
            JSON.stringify({
                'Action::Dash': noteText,
            }),
        ], 'notes.json', { type: 'application/json' });

        await expect(service.importNotes(file)).resolves.toBe(1);
        const savedText = db.put.mock.calls[0]?.[1] as string;

        expect(savedText).toBe(noteText);
    });

    it('imports notes for real optional and homebrew rule ids that include star markers', async () => {
        const { service, db } = createUserDataService();
        const file = new File([
            JSON.stringify({
                'Action::Administer Potion**': 'homebrew note',
                'Bonus action::Aim*': 'optional note',
            }),
        ], 'notes.json', { type: 'application/json' });

        await expect(service.importNotes(file)).resolves.toBe(2);

        expect(db.put).toHaveBeenCalledWith('Action::Administer Potion**', 'homebrew note');
        expect(db.put).toHaveBeenCalledWith('Bonus action::Aim*', 'optional note');
    });

    it('overwrites duplicate notes by id during import to match documented merge behavior', async () => {
        const { service, stateManager, db } = createUserDataService();
        stateManager.getState().user.notes.set('Action::Dash', 'old note');
        const file = new File([
            JSON.stringify({ 'Action::Dash': 'new note' }),
        ], 'notes.json', { type: 'application/json' });

        await expect(service.importNotes(file)).resolves.toBe(1);

        expect(stateManager.getState().user.notes.get('Action::Dash')).toBe('new note');
        expect(db.put).toHaveBeenCalledWith('Action::Dash', 'new note');
    });

    it('accepts safe note ids with punctuation used by rule titles', async () => {
        const { service, db } = createUserDataService();
        const file = new File([
            JSON.stringify({ 'Environment::Fear & Horror*': 'table note' }),
        ], 'notes.json', { type: 'application/json' });

        await expect(service.importNotes(file)).resolves.toBe(1);

        expect(db.put).toHaveBeenCalledWith('Environment::Fear & Horror*', 'table note');
    });

    it('rolls back imported note state when a later database write fails', async () => {
        const { service, stateManager, db } = createUserDataService();
        stateManager.getState().user.notes.set('Action::Dash', 'old dash');
        db.put.mockImplementation(async (key: string) => {
            if (key === 'Action::Dodge') throw new DOMException('denied', 'NotAllowedError');
        });
        const file = new File([
            JSON.stringify({
                'Action::Dash': 'new dash',
                'Action::Dodge': 'new dodge',
            }),
        ], 'notes.json', { type: 'application/json' });

        await expect(service.importNotes(file)).rejects.toThrow('denied');

        expect(stateManager.getState().user.notes.get('Action::Dash')).toBe('old dash');
        expect(stateManager.getState().user.notes.has('Action::Dodge')).toBe(false);
        expect(db.put).toHaveBeenCalledWith('Action::Dash', 'old dash');
    });

    it('serializes overlapping saves for the same note so the final DB write is the newest text', async () => {
        const stateManager = new StateManager();
        const pendingWrites: Array<{ text: string; resolve: () => void }> = [];
        const committed: string[] = [];
        const db = {
            getAll: vi.fn(async () => ({} as Record<string, string>)),
            put: vi.fn((_key: string, value: string) => new Promise<void>((resolve) => {
                pendingWrites.push({
                    text: value,
                    resolve: () => {
                        committed.push(value);
                        resolve();
                    },
                });
            })),
            delete: vi.fn(async (_key: string) => undefined),
        };
        const service = new UserDataService(createStorage(), stateManager, db as never, { broadcast: vi.fn() } as never);

        const first = service.saveNote('Action::Dash', 'older');
        const second = service.saveNote('Action::Dash', 'newer');

        for (let i = 0; i < 5 && db.put.mock.calls.length < 1; i++) await Promise.resolve();
        expect(db.put).toHaveBeenCalledTimes(1);
        pendingWrites[0]?.resolve();
        for (let i = 0; i < 5 && db.put.mock.calls.length < 2; i++) await Promise.resolve();
        expect(db.put).toHaveBeenCalledTimes(2);
        pendingWrites[1]?.resolve();

        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        expect(committed).toEqual(['older', 'newer']);
        expect(stateManager.getState().user.notes.get('Action::Dash')).toBe('newer');
    });

    it('falls back to JSON note download when CompressionStream is unavailable', async () => {
        vi.stubGlobal('CompressionStream', undefined);
        let downloadName = '';
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function clickAnchor(this: HTMLAnchorElement) {
            downloadName = this.download;
        });
        const { service, stateManager } = createUserDataService();
        stateManager.getState().user.notes.set('Action::Dash', 'note');

        await expect(service.exportNotes()).resolves.toBeUndefined();

        expect(click).toHaveBeenCalledOnce();
        expect(downloadName).toMatch(/quickref-notes-\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('downloads favorites when Web Share rejects', async () => {
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) });
        Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(async () => { throw new Error('share failed'); }) });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        const { service, stateManager } = createUserDataService();
        stateManager.getState().user.favorites.add('Action::Dash');

        await service.exportFavorites();

        expect(click).toHaveBeenCalledOnce();
    });
});

describe('Keyboard and focus behavior', () => {
    let offsetParentDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
        document.body.innerHTML = '';
        offsetParentDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
            configurable: true,
            get() { return document.body; },
        });
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    });

    afterEach(() => {
        if (offsetParentDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParentDescriptor);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('requires Shift for shortcuts registered with Shift', () => {
        const action = vi.fn();
        const shortcuts = new KeyboardShortcutsService({ announce: vi.fn() } as never);
        shortcuts.register('Ctrl+Shift+K', 'Test shortcut', 'Tests', action);
        shortcuts.initialize();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        expect(action).not.toHaveBeenCalled();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true, bubbles: true }));
        expect(action).toHaveBeenCalledOnce();
    });

    it('restores focus to the shortcuts opener when the modal closes', () => {
        document.body.innerHTML = '<button id="opener" type="button">Open shortcuts</button>';
        const opener = document.getElementById('opener') as HTMLButtonElement;
        const shortcuts = new KeyboardShortcutsService({ announce: vi.fn() } as never);

        opener.focus();
        shortcuts.open();
        shortcuts.close();

        expect(document.activeElement).toBe(opener);
    });

    it('moves arrow focus to item-content controls instead of inert item wrappers', () => {
        document.body.innerHTML = `
            <section class="${CONFIG.CSS.SECTION_CONTAINER}">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}" tabindex="0">Actions</h2>
                <div class="item"><div class="item-content" tabindex="0">Dash</div></div>
            </section>
        `;
        const title = document.querySelector(`.${CONFIG.CSS.SECTION_TITLE}`) as HTMLElement;
        const content = document.querySelector('.item-content') as HTMLElement;
        const navigation = new NavigationService({ isModalOpen: false } as never, { isActive: false } as never);

        navigation.initialize();
        title.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        expect(document.activeElement).toBe(content);
    });

    it('uses instant scrolling for keyboard navigation when reduced motion is requested', () => {
        const scrollIntoView = vi.fn();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
        vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
            matches: query === '(prefers-reduced-motion: reduce)',
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })));
        document.body.innerHTML = `
            <section class="${CONFIG.CSS.SECTION_CONTAINER}">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}" tabindex="0">Actions</h2>
                <div class="item"><button class="item-content" type="button">Dash</button></div>
            </section>
            <section class="${CONFIG.CSS.SECTION_CONTAINER}">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}" tabindex="0">Movement</h2>
            </section>
        `;
        const title = document.querySelector(`.${CONFIG.CSS.SECTION_TITLE}`) as HTMLElement;
        const navigation = new NavigationService({ isModalOpen: false } as never, { isActive: false } as never);

        navigation.initialize();
        title.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    });
});

describe('Favorite reorder keyboard accessibility', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('reorders favorite items with Shift+Arrow keys and announces the new position', () => {
        document.body.innerHTML = `
            <div id="${CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER}">
                <div class="${CONFIG.CSS.ITEM_CLASS}" ${CONFIG.ATTRIBUTES.POPUP_ID}="Action::Dash">
                    <button type="button" class="item-content"><span class="item-title">Dash</span></button>
                </div>
                <div class="${CONFIG.CSS.ITEM_CLASS}" ${CONFIG.ATTRIBUTES.POPUP_ID}="Action::Dodge">
                    <button type="button" class="item-content"><span class="item-title">Dodge</span></button>
                </div>
                <div class="${CONFIG.CSS.ITEM_CLASS}" ${CONFIG.ATTRIBUTES.POPUP_ID}="Action::Help">
                    <button type="button" class="item-content"><span class="item-title">Help</span></button>
                </div>
            </div>
        `;
        const updateFavoritesOrder = vi.fn();
        const announce = vi.fn();
        const manager = new (DragDropManager as unknown as new (...args: unknown[]) => DragDropManager)(
            CONFIG.ELEMENT_IDS.FAVORITES_CONTAINER,
            { updateFavoritesOrder },
            announce,
        );
        const controls = document.querySelectorAll<HTMLButtonElement>('.item-content');
        const moveEvent = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });

        controls[1]?.focus();
        controls[1]?.dispatchEvent(moveEvent);

        expect(moveEvent.defaultPrevented).toBe(true);
        expect([...document.querySelectorAll(`.${CONFIG.CSS.ITEM_CLASS}`)].map((item) =>
            item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID)
        )).toEqual(['Action::Dodge', 'Action::Dash', 'Action::Help']);
        expect(updateFavoritesOrder).toHaveBeenCalledWith(['Action::Dodge', 'Action::Dash', 'Action::Help']);
        expect(controls[1]?.getAttribute('aria-keyshortcuts')).toBe('Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown');
        expect(document.activeElement).toBe(controls[1]);
        expect(announce).toHaveBeenCalledWith('Dodge moved to position 1 of 3.');

        manager.destroy();
    });
});

describe('PersistenceService session safety', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not throw when sessionStorage rejects writes', () => {
        const stateManager = new StateManager();
        const storage = createStorage();
        vi.mocked(storage.setItem).mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
        const service = new PersistenceService(storage, stateManager);

        expect(() => service.saveSession()).not.toThrow();
    });

    it('drops unsafe popup geometry from restored sessions', () => {
        const storage = createStorage({
            [CONFIG.SESSION_STORAGE_KEYS.UI_SESSION]: JSON.stringify({
                activeZIndex: 1200,
                openPopups: [{
                    id: 'Action::Dash',
                    top: '12px',
                    left: 'calc(alert(1))',
                    zIndex: 'not-a-number',
                    width: '999999px',
                    height: '20rem',
                }],
            }),
        });
        const service = new PersistenceService(storage, new StateManager());

        const [popup] = service.loadSession();

        expect(popup).toMatchObject({ id: 'Action::Dash', top: '12px', height: '20rem' });
        expect(popup?.left).toBeUndefined();
        expect(popup?.zIndex).toBeUndefined();
        expect(popup?.width).toBeUndefined();
    });
});

describe('UIController section state resilience', () => {
    afterEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it('ignores malformed stored section state payloads instead of failing setup', () => {
        document.body.innerHTML = `
            <section id="section-action" class="${CONFIG.CSS.SECTION_CONTAINER}" data-section="action">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}">
                    <button type="button" class="section-toggle" aria-controls="section-action-content">Actions</button>
                </h2>
                <div id="section-action-content" class="${CONFIG.CSS.SECTION_CONTENT}"></div>
            </section>
        `;
        window.localStorage.setItem(CONFIG.STORAGE_KEYS.SECTION_STATES, JSON.stringify('collapsed'));
        const controller = new UIController(
            {
                get: (id: string) => document.getElementById(id) as HTMLElement,
                queryAll: (selector: string) => document.querySelectorAll(selector),
            } as never,
            new StateManager(),
            {
                a11y: { announce: vi.fn() },
                navigation: { invalidateFocusables: vi.fn() },
            } as never,
            {
                viewRenderer: {},
                windowManager: {},
            } as never,
        );

        expect(() => controller.setupCollapsibleSections()).not.toThrow();

        const section = document.getElementById('section-action') as HTMLElement;
        const toggle = section.querySelector('.section-toggle') as HTMLElement;
        expect(section.classList.contains(CONFIG.CSS.IS_COLLAPSED)).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('applies disclosure state to native section toggle buttons without replacing heading semantics', () => {
        document.body.innerHTML = `
            <section id="section-action" class="${CONFIG.CSS.SECTION_CONTAINER}" data-section="action">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}">
                    <button type="button" class="section-toggle" aria-controls="section-action-content">Actions</button>
                </h2>
                <div id="section-action-content" class="${CONFIG.CSS.SECTION_CONTENT}"></div>
            </section>
        `;
        const controller = new UIController(
            {
                get: (id: string) => document.getElementById(id) as HTMLElement,
                queryAll: (selector: string) => document.querySelectorAll(selector),
            } as never,
            new StateManager(),
            {
                a11y: { announce: vi.fn() },
                navigation: { invalidateFocusables: vi.fn() },
            } as never,
            {
                viewRenderer: {},
                windowManager: {},
            } as never,
        );

        controller.setupCollapsibleSections();

        const heading = document.querySelector(`.${CONFIG.CSS.SECTION_TITLE}`) as HTMLElement;
        const toggle = document.querySelector('.section-toggle') as HTMLButtonElement;
        expect(heading.hasAttribute('role')).toBe(false);
        expect(heading.hasAttribute('tabindex')).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');

        toggle.click();

        expect(document.getElementById('section-action')?.classList.contains(CONFIG.CSS.IS_COLLAPSED)).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });
});

describe('SyncService broadcast safety', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('does not require BroadcastChannel support', () => {
        vi.stubGlobal('BroadcastChannel', undefined);

        expect(() => new SyncService(new StateManager())).not.toThrow();
        expect(() => new SyncService(new StateManager()).broadcast('SETTING_CHANGE', {})).not.toThrow();
    });

    it('ignores malformed messages and postMessage clone failures', () => {
        const channels: Array<{ onmessage: ((event: MessageEvent) => void) | null; postMessage: ReturnType<typeof vi.fn> }> = [];
        class MockBroadcastChannel {
            onmessage: ((event: MessageEvent) => void) | null = null;
            onmessageerror: (() => void) | null = null;
            postMessage = vi.fn(() => { throw new DOMException('clone failed', 'DataCloneError'); });
            constructor() { channels.push(this); }
        }
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
        const stateManager = new StateManager();
        const published = vi.fn();
        stateManager.subscribe('externalStateChange', published);
        const service = new SyncService(stateManager);

        expect(() => channels[0]?.onmessage?.({ data: null } as MessageEvent)).not.toThrow();
        expect(() => service.broadcast('SETTING_CHANGE', () => undefined)).not.toThrow();
        expect(published).not.toHaveBeenCalled();
    });
});

describe('DataService validation and loading', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('passes an abort signal to data fetches and drops inline event handler data', async () => {
        const stateManager = new StateManager();
        stateManager.getState().settings.use2024Rules = false;
        const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([
            { title: 'Unsafe', description: '<img src=x onclick=alert(1)>' },
            { title: 'Safe', description: 'normal text' },
        ]), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const data = new DataService(stateManager);

        await data.ensureSectionDataLoaded('movement');
        data.buildRuleMap();

        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
        expect(stateManager.getState().data.ruleMap.has('Move::Unsafe')).toBe(false);
        expect(stateManager.getState().data.ruleMap.has('Move::Safe')).toBe(true);
    });

    it('drops malformed bullet payloads before they can reach renderers', async () => {
        const stateManager = new StateManager();
        stateManager.getState().settings.use2024Rules = false;
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
            { title: 'Malformed', bullets: [{ type: 'list', items: ['ok', 42] }] },
            { title: 'Safe', bullets: [{ type: 'list', items: ['ok'] }] },
        ]), { status: 200 })));
        const data = new DataService(stateManager);

        await data.ensureSectionDataLoaded('action');
        data.buildRuleMap();

        expect(stateManager.getState().data.ruleMap.has('Action::Malformed')).toBe(false);
        expect(stateManager.getState().data.ruleMap.has('Action::Safe')).toBe(true);
    });

    it('does not retry aborted data requests after the timeout guard fires', async () => {
        vi.useFakeTimers();
        const stateManager = new StateManager();
        stateManager.getState().settings.use2024Rules = false;
        const fetchMock = vi.fn(async () => {
            throw new DOMException('timed out', 'AbortError');
        });
        vi.stubGlobal('fetch', fetchMock);
        const data = new DataService(stateManager);

        const load = data.ensureSectionDataLoaded('movement');
        const assertion = expect(load).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(10_000);

        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('wraps non-json data responses in a data load error', async () => {
        const stateManager = new StateManager();
        stateManager.getState().settings.use2024Rules = false;
        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        })));
        const data = new DataService(stateManager);

        await expect(data.ensureSectionDataLoaded('movement')).rejects.toThrow('Expected JSON');
    });

    it('loads rule data from the active locale folder and keeps locale caches isolated', async () => {
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.settings.use2024Rules = false;
        state.settings.locale = 'id_ID';
        const fetchMock = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify([{
            title: String(url).includes('/id_ID/') ? 'Dash ID' : 'Dash EN',
            icon: 'run',
            optional: 'Standard rule',
        }]), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const data = new DataService(stateManager);

        await data.ensureSectionDataLoaded('movement');
        state.settings.locale = 'en_US';
        await data.ensureSectionDataLoaded('movement');

        expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
            `data/id_ID/rules/data_movement.json?v=${CONFIG.APP_VERSION}`,
            `data/en_US/rules/data_movement.json?v=${CONFIG.APP_VERSION}`,
        ]);
        expect(state.data.rulesets['2014'].movement?.[0]?.title).toBe('Dash EN');
    });

    it('warns before duplicate rule ids overwrite existing entries', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.settings.use2024Rules = false;
        state.data.rulesets['2014'].movement = [{ title: 'Dash' }, { title: 'Dash' }];
        const data = new DataService(stateManager);

        data.buildRuleMap();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate rule id'));
    });

    it('maps environment rules only to matching tagged environment subsections', () => {
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.settings.use2024Rules = false;
        state.data.rulesets['2014'].environment = [
            { title: 'Dim Light', tags: ['environment_light'] },
            { title: 'Heavy Obscurement', tags: ['environment_obscurance'] },
        ];
        const data = new DataService(stateManager);

        data.buildRuleMap();

        expect(state.data.ruleMap.get('Environment::Dim Light')?.sectionId).toBe('environment-light');
        expect(state.data.ruleMap.get('Environment::Heavy Obscurement')?.sectionId).toBe('environment-obscurance');
    });

    it('builds linker aliases for rule titles with optional and homebrew star markers', () => {
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.settings.use2024Rules = false;
        state.data.rulesets['2014'].action = [{ title: 'Administer Potion**' }];
        const data = new DataService(stateManager);

        data.buildRuleMap();
        data.buildLinkerData();

        expect(state.data.titleLookup.get('administer potion')).toBe('Action::Administer Potion**');
        expect('You can Administer Potion quickly.'.match(state.data.ruleLinkerRegex!)).toEqual(['Administer Potion']);
    });

    it('indexes summaries, bullets, table cells, and references for search', () => {
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.settings.use2024Rules = false;
        state.data.rulesets['2014'].action = [{
            title: 'Ready',
            description: 'Hold an action',
            summary: 'Reaction trigger summary',
            reference: 'PHB p.193',
            bullets: [
                { type: 'paragraph', content: 'Choose a perceivable circumstance.' },
                { type: 'list', items: ['Release the action after the trigger.'] },
                { type: 'table', headers: ['Case'], rows: [['Concentration until start of next turn']] },
            ],
        }];
        const data = new DataService(stateManager);

        data.buildRuleMap();
        data.ensureSearchIndicesReady();

        const searchIndex = state.data.ruleMap.get('Action::Ready')?.searchIndex ?? '';
        expect(searchIndex).toContain('reaction trigger summary');
        expect(searchIndex).toContain('perceivable circumstance');
        expect(searchIndex).toContain('release the action');
        expect(searchIndex).toContain('concentration until start');
        expect(searchIndex).toContain('phb p.193');
    });

    it('matches linkable rule titles that end with punctuation', () => {
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.settings.use2024Rules = false;
        state.data.rulesets['2014'].action = [{ title: 'Ready (Spell)' }];
        const data = new DataService(stateManager);

        data.buildRuleMap();
        data.buildLinkerData();

        expect('Use Ready (Spell) now.'.match(state.data.ruleLinkerRegex!)).toEqual(['Ready (Spell)']);
    });
});

describe('Theme manifest validation', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('falls back to the default theme when stored theme is not present in the manifest', async () => {
        document.body.innerHTML = `<select id="${CONFIG.ELEMENT_IDS.THEME_SELECT}"></select>`;
        const stateManager = new StateManager();
        stateManager.getState().settings.theme = 'missing-theme';
        stateManager.getState().settings.darkMode = false;
        const applyAppearance = vi.fn();
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            themes: [
                { id: 'original', displayName: 'Original' },
                { id: 'nord', displayName: 'Nord' },
            ],
        }), { status: 200 })));
        const controller = new UIController(
            { get: (id: string) => document.getElementById(id) as HTMLElement, queryAll: vi.fn() } as never,
            stateManager,
            {} as never,
            { viewRenderer: { applyAppearance }, windowManager: {} } as never,
        );

        await controller.loadAndPopulateThemes();

        expect(stateManager.getState().settings.theme).toBe(CONFIG.DEFAULTS.THEME);
        expect((document.getElementById(CONFIG.ELEMENT_IDS.THEME_SELECT) as HTMLSelectElement).value).toBe(CONFIG.DEFAULTS.THEME);
        expect(applyAppearance).toHaveBeenCalledWith(stateManager.getState().settings);
    });
});

describe('LocalizationService menu loading', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('applies localized menu strings with en_US fallback for missing values', async () => {
        document.body.innerHTML = `
            <span data-i18n="sections.movement.title">Movement</span>
            <span data-i18n="settings.language.description">Choose menu and rule data language.</span>
            <input id="search-input" data-i18n-placeholder="search.placeholder" data-i18n-aria-label="search.label">
        `;
        vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
            const target = String(url);
            if (target.includes('/id_ID/')) {
                return new Response(JSON.stringify({
                    locale: 'id_ID',
                    strings: {
                        'sections.movement.title': 'Pergerakan',
                        'search.placeholder': 'Cari aturan...',
                    },
                }), { status: 200 });
            }
            return new Response(JSON.stringify({
                locale: 'en_US',
                strings: {
                    'sections.movement.title': 'Movement',
                    'settings.language.description': 'Choose menu and rule data language.',
                    'search.placeholder': 'Search rules...',
                    'search.label': 'Search rules',
                },
            }), { status: 200 });
        }));
        const service = new LocalizationService();

        await service.loadAndApply('id_ID');

        expect(document.querySelector('[data-i18n="sections.movement.title"]')?.textContent).toBe('Pergerakan');
        expect(document.querySelector('[data-i18n="settings.language.description"]')?.textContent).toBe('Choose menu and rule data language.');
        expect(document.getElementById('search-input')?.getAttribute('placeholder')).toBe('Cari aturan...');
        expect(document.getElementById('search-input')?.getAttribute('aria-label')).toBe('Search rules');
    });

    it('keeps existing static text when locale menus cannot be fetched', async () => {
        document.body.innerHTML = '<span data-i18n="sections.movement.title">Movement</span>';
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new TypeError('offline');
        }));
        const service = new LocalizationService();

        await expect(service.loadAndApply('id_ID')).resolves.toBeUndefined();

        expect(document.querySelector('[data-i18n="sections.movement.title"]')?.textContent).toBe('Movement');
    });
});

describe('README modal accessibility', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('traps Tab focus inside the modal while open', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('# QuickRef\n\nReference content.', { status: 200 })));
        const service = new ReadmeService({ announce: vi.fn() } as never);

        await service.open();

        const closeBtn = document.querySelector('.readme-close-btn') as HTMLButtonElement;
        closeBtn.focus();
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

        closeBtn.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(closeBtn);
    });

    it('restores focus to the README opener when the modal closes', async () => {
        document.body.innerHTML = '<button id="opener" type="button">Open README</button>';
        vi.stubGlobal('fetch', vi.fn(async () => new Response('# QuickRef\n\nReference content.', { status: 200 })));
        const opener = document.getElementById('opener') as HTMLButtonElement;
        const service = new ReadmeService({ announce: vi.fn() } as never);

        opener.focus();
        await service.open();
        service.close();

        expect(document.activeElement).toBe(opener);
    });

    it('renders strong-formatted details summaries without exposing markdown HTML', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response([
            '# QuickRef',
            '',
            '## Q&A',
            '',
            '<details>',
            '<summary><strong>Why must this run over HTTP?</strong></summary>',
            '',
            'Because the app uses browser module and service-worker APIs.',
            '',
            '</details>',
        ].join('\n'), { status: 200 })));
        const service = new ReadmeService({ announce: vi.fn() } as never);

        await service.open();

        expect(document.querySelector('.readme-details-summary strong')?.textContent).toBe('Why must this run over HTTP?');
    });

    it('renders ordered setup steps as semantic list items with their code examples', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response([
            '# QuickRef',
            '',
            '## Getting Started',
            '',
            '1. **Clone the repository:**',
            '   ```bash',
            '   git clone https://example.test/repo.git',
            '   ```',
            '',
            '2. **Install dependencies:**',
            '   ```bash',
            '   npm install',
            '   ```',
        ].join('\n'), { status: 200 })));
        const service = new ReadmeService({ announce: vi.fn() } as never);

        await service.open();

        const list = document.querySelector('.readme-section-content ol') as HTMLOListElement | null;
        expect(list).toBeInstanceOf(HTMLOListElement);
        expect(list?.querySelectorAll(':scope > li')).toHaveLength(2);
        expect(list?.querySelector('li strong')?.textContent).toBe('Clone the repository:');
        expect(list?.querySelector('li pre code')?.textContent).toBe('git clone https://example.test/repo.git');
    });

    it('renders markdown links inside strong text without leaking raw markdown', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response([
            '# QuickRef',
            '',
            '## Prerequisites',
            '',
            '- **[Node.js](https://nodejs.org/) 22+** and **npm** (required for development and building).',
        ].join('\n'), { status: 200 })));
        const service = new ReadmeService({ announce: vi.fn() } as never);

        await service.open();

        const strong = document.querySelector('.readme-list strong') as HTMLElement | null;
        const link = strong?.querySelector('a');
        expect(strong?.textContent).toBe('Node.js 22+');
        expect(strong?.textContent).not.toContain('[Node.js]');
        expect(link?.textContent).toBe('Node.js');
        expect(link?.getAttribute('href')).toBe('https://nodejs.org/');
        expect(link?.getAttribute('target')).toBe('_blank');
        expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    });
});

describe('Changelog modal accessibility', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('restores focus to the changelog opener when the modal closes', async () => {
        document.body.innerHTML = '<button id="opener" type="button">Open changelog</button>';
        vi.stubGlobal('fetch', vi.fn(async () => new Response('## [1.0.0] - 2026-01-01\n\n- Fixed things.', { status: 200 })));
        const opener = document.getElementById('opener') as HTMLButtonElement;
        const service = new ChangelogService({ announce: vi.fn() } as never);

        opener.focus();
        await service.open();
        service.close();

        expect(document.activeElement).toBe(opener);
    });
});

describe('Onboarding motion accessibility', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        window.localStorage.clear();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('does not use smooth scrolling when reduced motion is requested', () => {
        const scrollIntoView = vi.fn();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
        vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
            matches: query === '(prefers-reduced-motion: reduce)',
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })));
        document.body.innerHTML = `
            <section data-section="action">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}">Action</h2>
                <div class="item">Dash</div>
            </section>
            <section data-section="settings">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}">Settings</h2>
            </section>
            <button id="shortcuts-fab-btn" type="button">?</button>
            <div id="${CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER}"></div>
        `;
        const service = new OnboardingService(window.localStorage, { announce: vi.fn() } as never);

        service.start();

        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    });

    it('uses one labelled dialog role for the welcome tour', () => {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
        document.body.innerHTML = `
            <section data-section="action">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}">Action</h2>
                <div class="item">Dash</div>
            </section>
            <section data-section="settings">
                <h2 class="${CONFIG.CSS.SECTION_TITLE}">Settings</h2>
            </section>
            <button id="shortcuts-fab-btn" type="button">?</button>
            <div id="${CONFIG.ELEMENT_IDS.ARIA_ANNOUNCER}"></div>
        `;
        const service = new OnboardingService(window.localStorage, { announce: vi.fn() } as never);

        service.start();

        const overlay = document.getElementById(CONFIG.ELEMENT_IDS.ONBOARDING_OVERLAY);
        const tooltip = overlay?.querySelector('.onboarding-tooltip');
        expect(overlay?.getAttribute('role')).toBe('dialog');
        expect(overlay?.getAttribute('aria-labelledby')).toBe(`${CONFIG.ELEMENT_IDS.ONBOARDING_OVERLAY}-title`);
        expect(overlay?.getAttribute('aria-describedby')).toBe(`${CONFIG.ELEMENT_IDS.ONBOARDING_OVERLAY}-body`);
        expect(tooltip?.hasAttribute('role')).toBe(false);
    });
});

describe('WindowManager popup lifecycle', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="${CONFIG.ELEMENT_IDS.POPUP_CONTAINER}">
                <a class="rule-link ${CONFIG.CSS.LINK_DISABLED}" data-popup-id="Action::Dash">Dash</a>
            </div>
            <button id="${CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN}" class="${CONFIG.CSS.IS_VISIBLE}"></button>
            <div id="${CONFIG.ELEMENT_IDS.MINIMIZED_BAR}"></div>
        `;
        window.history.replaceState(null, '', '#Ac-Dash');
        document.body.style.setProperty('--is-modal-open', '1');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.history.replaceState(null, '', window.location.pathname);
        document.body.style.removeProperty('--is-modal-open');
    });

    it('cleans modal state, URL, link state, and session when minimizing a popup', () => {
        const stateManager = new StateManager();
        const state: AppState = stateManager.getState();
        const dialog = document.createElement('dialog') as HTMLDialogElement;
        dialog.className = CONFIG.CSS.POPUP_WINDOW;
        dialog.innerHTML = '<span class="popup-title">Dash</span>';
        Object.defineProperty(dialog, 'close', { configurable: true, value: vi.fn() });
        document.getElementById(CONFIG.ELEMENT_IDS.POPUP_CONTAINER)?.appendChild(dialog);
        state.ui.openPopups.set('Action::Dash', dialog);
        const persistence = { saveSession: vi.fn() };
        const manager = new WindowManager({
            domProvider: { get: (id: string) => document.getElementById(id) as HTMLElement } as never,
            stateManager,
            persistence: persistence as never,
            a11y: { announce: vi.fn() } as never,
            popupFactory: {} as never,
            data: {} as never,
        });

        manager.minimizePopup('Action::Dash');

        expect(state.ui.openPopups.has('Action::Dash')).toBe(false);
        expect(document.body.style.getPropertyValue('--is-modal-open')).toBe('0');
        expect(window.location.hash).toBe('');
        expect(document.querySelector('.rule-link')?.classList.contains(CONFIG.CSS.LINK_DISABLED)).toBe(false);
        expect(persistence.saveSession).toHaveBeenCalledOnce();
        const close = document.querySelector('.minimized-tab-close') as HTMLButtonElement;
        expect(close.tagName).toBe('BUTTON');
        expect(close.getAttribute('type')).toBe('button');
        expect(close.getAttribute('aria-label')).toBe('Close minimized Dash popup');
    });

    it('ignores oversized popup ids from the URL hash before attempting data loads', async () => {
        document.body.innerHTML = `
            <div id="${CONFIG.ELEMENT_IDS.POPUP_CONTAINER}"></div>
            <button id="${CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN}"></button>
            <div id="${CONFIG.ELEMENT_IDS.MINIMIZED_BAR}"></div>
        `;
        window.history.replaceState(null, '', `#Ac-${'A'.repeat(500)}`);
        const data = {
            ensureAllDataLoadedForActiveRuleset: vi.fn(async () => undefined),
            buildRuleMap: vi.fn(),
        };
        const manager = new WindowManager({
            domProvider: { get: (id: string) => document.getElementById(id) as HTMLElement } as never,
            stateManager: new StateManager(),
            persistence: { saveSession: vi.fn() } as never,
            a11y: { announce: vi.fn() } as never,
            popupFactory: {} as never,
            data: data as never,
        });

        manager.loadPopupsFromURL();
        await Promise.resolve();

        expect(data.ensureAllDataLoadedForActiveRuleset).not.toHaveBeenCalled();
        expect(window.location.hash).toBe('');
    });

    it('renders generated rule cross-references as native keyboard-focusable links', async () => {
        document.body.innerHTML = `
            <div id="${CONFIG.ELEMENT_IDS.POPUP_CONTAINER}"></div>
            <button id="${CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN}"></button>
            <div id="${CONFIG.ELEMENT_IDS.MINIMIZED_BAR}"></div>
        `;
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.data.ruleMap.set('Action::Dash', {
            ruleData: { title: 'Dash' },
            type: 'Action',
            sectionId: 'section-action',
        });
        state.data.ruleMap.set('Action::Dodge', {
            ruleData: { title: 'Dodge' },
            type: 'Action',
            sectionId: 'section-action',
        });
        state.data.ruleLinkerRegex = /Dodge/g;
        state.data.titleLookup.set('dodge', 'Action::Dodge');
        const popupFactory = {
            create: vi.fn((_id: string, _ruleInfo: unknown, linkify: (html: string) => string) => {
                const dialog = document.createElement('dialog') as HTMLDialogElement;
                dialog.className = CONFIG.CSS.POPUP_WINDOW;
                Object.defineProperty(dialog, 'show', { configurable: true, value: vi.fn() });
                Object.defineProperty(dialog, 'close', { configurable: true, value: vi.fn() });
                dialog.innerHTML = `<div class="popup-content" tabindex="-1">${linkify('See Dodge')}</div>`;
                return dialog;
            }),
        };
        const manager = new WindowManager({
            domProvider: { get: (id: string) => document.getElementById(id) as HTMLElement } as never,
            stateManager,
            persistence: { saveSession: vi.fn() } as never,
            a11y: { announce: vi.fn() } as never,
            popupFactory: popupFactory as never,
            data: {} as never,
        });

        await manager.togglePopup('Action::Dash');

        const link = document.querySelector('a.rule-link') as HTMLAnchorElement | null;
        expect(link?.getAttribute('href')).toBe('#Ac-Dodge');
        expect(link?.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID)).toBe('Action::Dodge');

        await manager.togglePopup('Action::Dodge');

        document.querySelectorAll<HTMLAnchorElement>('a.rule-link').forEach((disabledLink) => {
            expect(disabledLink.getAttribute('href')).toBeNull();
            expect(disabledLink.getAttribute('aria-disabled')).toBe('true');
        });
    });

    it('builds linker data before creating a restored or hash-opened popup', async () => {
        document.body.innerHTML = `
            <div id="${CONFIG.ELEMENT_IDS.POPUP_CONTAINER}"></div>
            <button id="${CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN}"></button>
            <div id="${CONFIG.ELEMENT_IDS.MINIMIZED_BAR}"></div>
        `;
        const stateManager = new StateManager();
        const state = stateManager.getState();
        state.data.ruleMap.set('Action::Dash', {
            ruleData: { title: 'Dash' },
            type: 'Action',
            sectionId: 'section-action',
        });
        state.data.ruleMap.set('Action::Dodge', {
            ruleData: { title: 'Dodge' },
            type: 'Action',
            sectionId: 'section-action',
        });
        const data = {
            buildLinkerData: vi.fn(() => {
                state.data.ruleLinkerRegex = /Dodge/g;
                state.data.titleLookup.set('dodge', 'Action::Dodge');
            }),
        };
        const popupFactory = {
            create: vi.fn((_id: string, _ruleInfo: unknown, linkify: (html: string) => string) => {
                const dialog = document.createElement('dialog') as HTMLDialogElement;
                dialog.className = CONFIG.CSS.POPUP_WINDOW;
                Object.defineProperty(dialog, 'show', { configurable: true, value: vi.fn() });
                Object.defineProperty(dialog, 'close', { configurable: true, value: vi.fn() });
                dialog.innerHTML = `<div class="popup-content" tabindex="-1">${linkify('See Dodge')}</div>`;
                return dialog;
            }),
        };
        const manager = new WindowManager({
            domProvider: { get: (id: string) => document.getElementById(id) as HTMLElement } as never,
            stateManager,
            persistence: { saveSession: vi.fn() } as never,
            a11y: { announce: vi.fn() } as never,
            popupFactory: popupFactory as never,
            data: data as never,
        });

        await manager.togglePopup('Action::Dash');

        expect(data.buildLinkerData).toHaveBeenCalledOnce();
        expect(document.querySelector('a.rule-link')?.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID)).toBe('Action::Dodge');
    });
});

describe('Template and render accessibility behavior', () => {
    const createDomProvider = () => ({
        get: (id: string) => document.getElementById(id) as HTMLElement,
        getTemplate: (id: string) => document.getElementById(id) as HTMLTemplateElement,
        queryAll: (selector: string) => document.querySelectorAll(selector),
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses DOM-safe popup title and notes IDs derived from rule IDs', () => {
        document.body.innerHTML = `
            <section id="section-action" class="${CONFIG.CSS.SECTION_CONTAINER}"></section>
            <template id="${CONFIG.ELEMENT_IDS.POPUP_TEMPLATE}">
                <dialog class="popup-window">
                    <header class="popup-header"><span class="popup-title"></span></header>
                    <span class="popup-type"></span>
                    <p class="popup-description"></p>
                    <p class="popup-summary"></p>
                    <div class="popup-bullets"></div>
                    <div class="popup-reference-container">
                        <p class="popup-reference hidden"></p>
                        <button class="popup-toggle-details-btn"></button>
                    </div>
                    <label class="popup-notes-label"></label>
                    <textarea class="popup-notes-textarea"></textarea>
                </dialog>
            </template>
        `;
        const template = new TemplateService(createDomProvider() as never);

        const popup = template.createPopupElement(
            'Action::Dash Attack',
            { ruleData: { title: 'Dash Attack' }, type: 'Action', sectionId: 'section-action' },
            (html) => html,
            () => '',
        );
        const title = popup.querySelector('.popup-title') as HTMLElement;
        const textarea = popup.querySelector('.popup-notes-textarea') as HTMLTextAreaElement;
        const label = popup.querySelector('.popup-notes-label') as HTMLElement;

        expect(title.id).not.toMatch(/\s/);
        expect(textarea.id).not.toMatch(/\s/);
        expect(popup.getAttribute('aria-labelledby')).toBe(title.id);
        expect(label.getAttribute('for')).toBe(textarea.id);
    });

    it('copies accessible section header text color to generated popup headers', () => {
        document.body.innerHTML = `
            <section id="section-action" class="${CONFIG.CSS.SECTION_CONTAINER}" style="--section-header-text: #000;"></section>
            <template id="${CONFIG.ELEMENT_IDS.POPUP_TEMPLATE}">
                <dialog class="popup-window">
                    <header class="popup-header"><h2 class="popup-title"></h2></header>
                    <span class="popup-type"></span>
                    <p class="popup-description"></p>
                    <p class="popup-summary"></p>
                    <div class="popup-bullets"></div>
                    <div class="popup-reference-container">
                        <p class="popup-reference hidden"></p>
                        <button class="popup-toggle-details-btn"></button>
                    </div>
                    <label class="popup-notes-label"></label>
                    <textarea class="popup-notes-textarea"></textarea>
                </dialog>
            </template>
        `;
        const template = new TemplateService(createDomProvider() as never);

        const popup = template.createPopupElement(
            'Action::Dash',
            { ruleData: { title: 'Dash' }, type: 'Action', sectionId: 'section-action' },
            (html) => html,
            () => '',
        );

        expect(popup.style.getPropertyValue('--section-header-text')).toBe('#000');
    });

    it('sets rule-specific favorite button names and pressed state', () => {
        document.body.innerHTML = `
            <template id="${CONFIG.ELEMENT_IDS.RULE_ITEM_TEMPLATE}">
                <div class="item itemsize">
                    <button type="button" class="item-content">
                        <div class="item-icon iconsize"></div>
                        <div class="item-text-container">
                            <div class="item-title"></div>
                            <div class="item-desc"></div>
                        </div>
                    </button>
                    <button class="favorite-btn"></button>
                </div>
            </template>
        `;
        const template = new TemplateService(createDomProvider() as never);

        const favorite = template.createRuleItemElement('Action::Dash', { title: 'Dash' }, true);
        const notFavorite = template.createRuleItemElement('Action::Dodge', { title: 'Dodge' }, false);

        expect(favorite.querySelector('.favorite-btn')?.getAttribute('aria-pressed')).toBe('true');
        expect(favorite.querySelector('.favorite-btn')?.getAttribute('aria-label')).toBe('Remove Dash from favorites');
        expect(notFavorite.querySelector('.favorite-btn')?.getAttribute('aria-pressed')).toBe('false');
        expect(notFavorite.querySelector('.favorite-btn')?.getAttribute('aria-label')).toBe('Add Dodge to favorites');
    });

    it('associates popup detail toggles with the details region', () => {
        document.body.innerHTML = `
            <section id="section-action" class="${CONFIG.CSS.SECTION_CONTAINER}"></section>
            <template id="${CONFIG.ELEMENT_IDS.POPUP_TEMPLATE}">
                <dialog class="popup-window">
                    <header class="popup-header"><h2 class="popup-title"></h2></header>
                    <span class="popup-type"></span>
                    <p class="popup-description"></p>
                    <p class="popup-summary"></p>
                    <div class="popup-bullets hidden"></div>
                    <div class="popup-reference-container">
                        <p class="popup-reference hidden"></p>
                        <button class="popup-toggle-details-btn"></button>
                    </div>
                    <label class="popup-notes-label"></label>
                    <textarea class="popup-notes-textarea"></textarea>
                </dialog>
            </template>
        `;
        const template = new TemplateService(createDomProvider() as never);

        const popup = template.createPopupElement(
            'Action::Ready',
            {
                ruleData: {
                    title: 'Ready',
                    summary: 'Prepare a response.',
                    bullets: [{ type: 'paragraph', content: 'Choose a trigger.' }],
                },
                type: 'Action',
                sectionId: 'section-action',
            },
            (html) => html,
            () => '',
        );
        const toggle = popup.querySelector('.popup-toggle-details-btn') as HTMLButtonElement;
        const detailsId = toggle.getAttribute('aria-controls');

        expect(detailsId).toBeTruthy();
        expect((popup.querySelector('.popup-bullets') as HTMLElement).id).toBe(detailsId);
    });

    it('sets column scope on generated rule table headers', () => {
        document.body.innerHTML = `
            <section id="section-action" class="${CONFIG.CSS.SECTION_CONTAINER}"></section>
            <template id="${CONFIG.ELEMENT_IDS.POPUP_TEMPLATE}">
                <dialog class="popup-window">
                    <header class="popup-header"><h2 class="popup-title"></h2></header>
                    <span class="popup-type"></span>
                    <p class="popup-description"></p>
                    <p class="popup-summary"></p>
                    <div class="popup-bullets"></div>
                    <div class="popup-reference-container">
                        <p class="popup-reference hidden"></p>
                        <button class="popup-toggle-details-btn"></button>
                    </div>
                    <label class="popup-notes-label"></label>
                    <textarea class="popup-notes-textarea"></textarea>
                </dialog>
            </template>
        `;
        const template = new TemplateService(createDomProvider() as never);

        const popup = template.createPopupElement(
            'Action::Help',
            {
                ruleData: {
                    title: 'Help',
                    bullets: [{ type: 'table', headers: ['Action', 'Effect'], rows: [['Help', 'Aid an ally']] }],
                },
                type: 'Action',
                sectionId: 'section-action',
            },
            (html) => html,
            () => '',
        );

        expect([...popup.querySelectorAll('th')].map((th) => th.getAttribute('scope'))).toEqual(['col', 'col']);
    });

    it('adds a print-only image fallback for CSS background icons', () => {
        document.body.innerHTML = `
            <main id="${CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA}">
                <div id="basic-actions"></div>
            </main>
            <div id="${CONFIG.ELEMENT_IDS.NOTIFICATION_CONTAINER}"></div>
            <template id="${CONFIG.ELEMENT_IDS.RULE_ITEM_TEMPLATE}">
                <div class="item itemsize">
                    <div class="item-content" role="button" tabindex="0">
                        <div class="item-icon iconsize"></div>
                        <div class="item-text-container">
                            <div class="item-title"></div>
                            <div class="item-desc"></div>
                        </div>
                    </div>
                    <button class="favorite-btn"></button>
                </div>
            </template>
        `;
        const computedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
            if ((el as HTMLElement).classList.contains('item-icon')) {
                return { backgroundImage: 'url("http://localhost/img/run.webp")' } as CSSStyleDeclaration;
            }
            return { backgroundImage: 'none' } as CSSStyleDeclaration;
        });
        const stateManager = new StateManager();
        const template = new TemplateService(createDomProvider() as never);
        const renderer = new ViewRenderer(
            createDomProvider() as never,
            stateManager,
            { isFavorite: vi.fn(() => false) } as never,
            template,
        );

        renderer.renderSection('basic-actions', [{
            popupId: 'Action::Dash',
            ruleInfo: { ruleData: { title: 'Dash', icon: 'run' }, type: 'Action', sectionId: 'section-action' },
        }]);

        const printImg = document.querySelector('.item-icon-print-img') as HTMLImageElement | null;
        expect(computedStyle).toHaveBeenCalled();
        expect(printImg?.src).toBe('http://localhost/img/run.webp');
        expect(printImg?.getAttribute('aria-hidden')).toBe('true');
    });

    it('reuses resolved print icon URLs for duplicate icons in a render batch', () => {
        document.body.innerHTML = `
            <main id="${CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA}">
                <div id="basic-actions"></div>
            </main>
            <div id="${CONFIG.ELEMENT_IDS.NOTIFICATION_CONTAINER}"></div>
            <template id="${CONFIG.ELEMENT_IDS.RULE_ITEM_TEMPLATE}">
                <div class="item itemsize">
                    <div class="item-content" role="button" tabindex="0">
                        <div class="item-icon iconsize"></div>
                        <div class="item-text-container">
                            <div class="item-title"></div>
                            <div class="item-desc"></div>
                        </div>
                    </div>
                    <button class="favorite-btn"></button>
                </div>
            </template>
        `;
        const computedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
            if ((el as HTMLElement).classList.contains('item-icon')) {
                return { backgroundImage: 'url("http://localhost/img/grab.webp")' } as CSSStyleDeclaration;
            }
            return { backgroundImage: 'none' } as CSSStyleDeclaration;
        });
        const stateManager = new StateManager();
        const template = new TemplateService(createDomProvider() as never);
        const renderer = new ViewRenderer(
            createDomProvider() as never,
            stateManager,
            { isFavorite: vi.fn(() => false) } as never,
            template,
        );

        renderer.renderSection('basic-actions', [{
            popupId: 'Action::Grapple',
            ruleInfo: { ruleData: { title: 'Grapple', icon: 'grab' }, type: 'Action', sectionId: 'section-action' },
        }, {
            popupId: 'Action::Escape Grapple',
            ruleInfo: { ruleData: { title: 'Escape Grapple', icon: 'grab' }, type: 'Action', sectionId: 'section-action' },
        }]);

        expect(computedStyle).toHaveBeenCalledTimes(1);
        expect([...document.querySelectorAll<HTMLImageElement>('.item-icon-print-img')].map((img) => img.src)).toEqual([
            'http://localhost/img/grab.webp',
            'http://localhost/img/grab.webp',
        ]);
    });

    it('extracts print-only image fallbacks from image-set CSS backgrounds', () => {
        document.body.innerHTML = `
            <main id="${CONFIG.ELEMENT_IDS.MAIN_SCROLL_AREA}">
                <div id="basic-actions"></div>
            </main>
            <div id="${CONFIG.ELEMENT_IDS.NOTIFICATION_CONTAINER}"></div>
            <template id="${CONFIG.ELEMENT_IDS.RULE_ITEM_TEMPLATE}">
                <div class="item itemsize">
                    <div class="item-content" role="button" tabindex="0">
                        <div class="item-icon iconsize"></div>
                        <div class="item-text-container">
                            <div class="item-title"></div>
                            <div class="item-desc"></div>
                        </div>
                    </div>
                    <button class="favorite-btn"></button>
                </div>
            </template>
        `;
        vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
            if ((el as HTMLElement).classList.contains('item-icon')) {
                return { backgroundImage: 'image-set(url("http://localhost/img/run.webp") 1x)' } as CSSStyleDeclaration;
            }
            return { backgroundImage: 'none' } as CSSStyleDeclaration;
        });
        const stateManager = new StateManager();
        const template = new TemplateService(createDomProvider() as never);
        const renderer = new ViewRenderer(
            createDomProvider() as never,
            stateManager,
            { isFavorite: vi.fn(() => false) } as never,
            template,
        );

        renderer.renderSection('basic-actions', [{
            popupId: 'Action::Dash',
            ruleInfo: { ruleData: { title: 'Dash', icon: 'run' }, type: 'Action', sectionId: 'section-action' },
        }]);

        expect((document.querySelector('.item-icon-print-img') as HTMLImageElement | null)?.src).toBe('http://localhost/img/run.webp');
    });

    it('renders an accessible fallback for unknown bullet types instead of raw JSON', () => {
        document.body.innerHTML = `
            <section id="section-action" class="${CONFIG.CSS.SECTION_CONTAINER}"></section>
            <template id="${CONFIG.ELEMENT_IDS.POPUP_TEMPLATE}">
                <dialog class="popup-window">
                    <header class="popup-header"><span class="popup-title"></span></header>
                    <span class="popup-type"></span>
                    <p class="popup-description"></p>
                    <p class="popup-summary"></p>
                    <div class="popup-bullets"></div>
                    <div class="popup-reference-container">
                        <p class="popup-reference hidden"></p>
                        <button class="popup-toggle-details-btn"></button>
                    </div>
                    <label class="popup-notes-label"></label>
                    <textarea class="popup-notes-textarea"></textarea>
                </dialog>
            </template>
        `;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const template = new TemplateService(createDomProvider() as never);

        const popup = template.createPopupElement(
            'Action::Dash',
            {
                ruleData: { title: 'Dash', bullets: [{ type: 'unsupported' } as never] },
                type: 'Action',
                sectionId: 'section-action',
            },
            (html) => html,
            () => '',
        );

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown bullet type'));
        expect(popup.querySelector('.popup-bullets')?.textContent).toContain('Unsupported rule detail format.');
        expect(popup.querySelector('.popup-bullets')?.textContent).not.toContain('"unsupported"');
    });
});
