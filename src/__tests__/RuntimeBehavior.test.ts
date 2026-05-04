// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config.js';
import { StateManager } from '../state/StateManager.js';
import { DataService } from '../services/DataService.js';
import { KeyboardShortcutsService } from '../services/KeyboardShortcutsService.js';
import { NavigationService } from '../services/NavigationService.js';
import { PersistenceService } from '../services/PersistenceService.js';
import { SyncService } from '../services/SyncService.js';
import { UserDataService } from '../services/UserDataService.js';
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
                <h2 class="${CONFIG.CSS.SECTION_TITLE}">Actions</h2>
                <div class="${CONFIG.CSS.SECTION_CONTENT}"></div>
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
        const header = section.querySelector(`.${CONFIG.CSS.SECTION_TITLE}`) as HTMLElement;
        expect(section.classList.contains(CONFIG.CSS.IS_COLLAPSED)).toBe(false);
        expect(header.getAttribute('aria-expanded')).toBe('true');
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
