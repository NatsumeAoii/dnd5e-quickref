// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { WindowManager } from '../ui/WindowManager.js';
import { PopupLinkifier } from '../ui/PopupLinkifier.js';
import { StateManager } from '../state/StateManager.js';
import { CONFIG } from '../config.js';
import { LocalizationService } from '../services/LocalizationService.js';
import { DataService } from '../services/DataService.js';
import { UIController } from '../ui/UIController.js';
import { runBenchmark } from '../utils/BenchmarkHarness.js';


/**
 * Property 15: Section color cache prevents getComputedStyle on popup creation
 *
 * For any section that has been rendered at least once, creating a popup for a
 * rule in that section SHALL read border and header colors from the section color
 * cache without calling `getComputedStyle`.
 *
 * **Validates: Requirements 6.4**
 */
describe('Property 15: Section color cache prevents getComputedStyle on popup creation', () => {
    let getComputedStyleSpy: ReturnType<typeof vi.fn>;

    /** Pool of section IDs to generate tests against */
    const sectionIdPool = [
        'basic-movement',
        'basic-actions',
        'basic-bonus-actions',
        'basic-reactions',
        'basic-conditions',
        'environment-obscurance',
        'environment-light',
        'environment-vision',
        'environment-cover',
        'environment-other',
    ];

    /**
     * Arbitrary that generates a section ID from the known pool and a
     * count of popup creations (2+ to ensure at least one cached read).
     */
    const sectionAndPopupCountArb = fc.record({
        sectionId: fc.constantFrom(...sectionIdPool),
        popupCount: fc.integer({ min: 2, max: 10 }),
    });

    beforeEach(() => {
        getComputedStyleSpy = vi.fn().mockReturnValue({
            borderColor: 'rgb(100, 50, 50)',
            getPropertyValue: vi.fn().mockReturnValue('#ff0000'),
        });
        vi.stubGlobal('getComputedStyle', getComputedStyleSpy);
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('second popup creation for same section does not call getComputedStyle', () => {
        fc.assert(
            fc.property(sectionAndPopupCountArb, ({ sectionId, popupCount }) => {
                // Reset for each iteration
                getComputedStyleSpy.mockClear();
                document.body.innerHTML = `
                    <div id="${CONFIG.ELEMENT_IDS.POPUP_CONTAINER}"></div>
                    <button id="${CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN}"></button>
                    <div id="${CONFIG.ELEMENT_IDS.MINIMIZED_BAR}"></div>
                    <section id="${sectionId}" class="${CONFIG.CSS.SECTION_CONTAINER}">
                        <h2 class="${CONFIG.CSS.SECTION_TITLE}">Section</h2>
                        <div class="${CONFIG.CSS.SECTION_CONTENT}"></div>
                    </section>
                `;

                const localStateManager = new StateManager();
                const state = localStateManager.getState();

                // Set up rule data for multiple popup IDs in the same section
                for (let i = 0; i < popupCount; i++) {
                    const ruleId = `Action::Rule${i}_${sectionId}`;
                    state.data.ruleMap.set(ruleId, {
                        ruleData: { title: `Rule ${i}` },
                        type: 'Action',
                        sectionId,
                    });
                }

                const popupFactory = {
                    create: vi.fn(() => {
                        const dialog = document.createElement('dialog') as HTMLDialogElement;
                        dialog.className = CONFIG.CSS.POPUP_WINDOW;
                        dialog.innerHTML = '<div class="popup-content" tabindex="-1"></div>';
                        Object.defineProperty(dialog, 'show', { configurable: true, value: vi.fn() });
                        Object.defineProperty(dialog, 'close', { configurable: true, value: vi.fn() });
                        return dialog;
                    }),
                };

                // Stub linker data so #ensureLinkerDataReady doesn't try to build it
                state.data.ruleLinkerRegex = /(?!)/;

                const manager = new WindowManager({
                    domProvider: { get: (id: string) => document.getElementById(id) as HTMLElement } as never,
                    stateManager: localStateManager,
                    persistence: { saveSession: vi.fn() } as never,
                    a11y: { announce: vi.fn() } as never,
                    popupFactory: popupFactory as never,
                    data: { buildLinkerData: vi.fn() } as never,
                });

                // Create popups sequentially for rules in the same section
                for (let i = 0; i < popupCount; i++) {
                    const ruleId = `Action::Rule${i}_${sectionId}`;
                    void manager.togglePopup(ruleId);
                }

                // The first popup should trigger exactly 1 getComputedStyle call for the section.
                // All subsequent popups for the same section should read from cache.
                expect(getComputedStyleSpy).toHaveBeenCalledTimes(1);
            }),
            { numRuns: 100 },
        );
    });

    it('different sections each trigger exactly one getComputedStyle call', () => {
        /**
         * Arbitrary for unique sets of section IDs, each receiving multiple popups.
         */
        const multipleSectionsArb = fc.record({
            sections: fc.uniqueArray(fc.constantFrom(...sectionIdPool), { minLength: 2, maxLength: 5 }),
            popupsPerSection: fc.integer({ min: 1, max: 5 }),
        });

        fc.assert(
            fc.property(multipleSectionsArb, ({ sections, popupsPerSection }) => {
                getComputedStyleSpy.mockClear();

                // Build DOM with all sections present
                const sectionHtml = sections.map((id) =>
                    `<section id="${id}" class="${CONFIG.CSS.SECTION_CONTAINER}">
                        <h2 class="${CONFIG.CSS.SECTION_TITLE}">Section</h2>
                        <div class="${CONFIG.CSS.SECTION_CONTENT}"></div>
                    </section>`,
                ).join('');

                document.body.innerHTML = `
                    <div id="${CONFIG.ELEMENT_IDS.POPUP_CONTAINER}"></div>
                    <button id="${CONFIG.ELEMENT_IDS.CLOSE_ALL_POPUPS_BTN}"></button>
                    <div id="${CONFIG.ELEMENT_IDS.MINIMIZED_BAR}"></div>
                    ${sectionHtml}
                `;

                const localStateManager = new StateManager();
                const state = localStateManager.getState();

                // Register rules for each section
                for (const sectionId of sections) {
                    for (let i = 0; i < popupsPerSection; i++) {
                        const ruleId = `Action::Rule${i}_${sectionId}`;
                        state.data.ruleMap.set(ruleId, {
                            ruleData: { title: `Rule ${i} in ${sectionId}` },
                            type: 'Action',
                            sectionId,
                        });
                    }
                }

                const popupFactory = {
                    create: vi.fn(() => {
                        const dialog = document.createElement('dialog') as HTMLDialogElement;
                        dialog.className = CONFIG.CSS.POPUP_WINDOW;
                        dialog.innerHTML = '<div class="popup-content" tabindex="-1"></div>';
                        Object.defineProperty(dialog, 'show', { configurable: true, value: vi.fn() });
                        Object.defineProperty(dialog, 'close', { configurable: true, value: vi.fn() });
                        return dialog;
                    }),
                };

                state.data.ruleLinkerRegex = /(?!)/;

                const manager = new WindowManager({
                    domProvider: { get: (id: string) => document.getElementById(id) as HTMLElement } as never,
                    stateManager: localStateManager,
                    persistence: { saveSession: vi.fn() } as never,
                    a11y: { announce: vi.fn() } as never,
                    popupFactory: popupFactory as never,
                    data: { buildLinkerData: vi.fn() } as never,
                });

                // Create all popups across all sections
                for (const sectionId of sections) {
                    for (let i = 0; i < popupsPerSection; i++) {
                        const ruleId = `Action::Rule${i}_${sectionId}`;
                        void manager.togglePopup(ruleId);
                    }
                }

                // getComputedStyle should be called exactly once per unique section
                expect(getComputedStyleSpy).toHaveBeenCalledTimes(sections.length);
            }),
            { numRuns: 100 },
        );
    });
});


/**
 * Property 21: Skip unchanged locale string writes
 *
 * For any DOM element where the current textContent (or attribute value) already
 * equals the target locale string, applying localization SHALL not perform a DOM
 * write for that element.
 *
 * **Validates: Requirements 8.2**
 */
describe('Property 21: Skip unchanged locale string writes', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        document.body.innerHTML = '';
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    /**
     * Arbitrary generating a non-empty alphanumeric string suitable for i18n keys.
     */
    const i18nKeyArb = fc.string({ minLength: 1, maxLength: 20 })
        .filter((s) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s));

    /**
     * Arbitrary generating a non-empty locale string value (the translated text).
     */
    const localeStringArb = fc.string({ minLength: 1, maxLength: 100 })
        .filter((s) => s.trim().length > 0);

    /**
     * Arbitrary generating one of the four i18n attribute types.
     */
    const i18nAttrTypeArb = fc.constantFrom(
        'data-i18n' as const,
        'data-i18n-placeholder' as const,
        'data-i18n-aria-label' as const,
        'data-i18n-title' as const,
    );

    it('no DOM write occurs when element value already matches target locale string', async () => {
        await fc.assert(
            fc.asyncProperty(
                i18nKeyArb,
                localeStringArb,
                i18nAttrTypeArb,
                async (key, value, attrType) => {
                    // Setup: create a DOM element with the i18n attribute
                    document.body.innerHTML = '';
                    const element = document.createElement('div');
                    element.setAttribute(attrType, key);

                    // Pre-set the element's current value to match the target
                    if (attrType === 'data-i18n') {
                        element.textContent = value;
                    } else if (attrType === 'data-i18n-placeholder') {
                        element.setAttribute('placeholder', value);
                    } else if (attrType === 'data-i18n-aria-label') {
                        element.setAttribute('aria-label', value);
                    } else if (attrType === 'data-i18n-title') {
                        element.setAttribute('title', value);
                    }

                    document.body.appendChild(element);

                    // Mock fetch to return locale strings with our key/value
                    const menuPayload = { strings: { [key]: value } };
                    globalThis.fetch = vi.fn().mockResolvedValue({
                        ok: true,
                        json: () => Promise.resolve(menuPayload),
                    });

                    // Spy on the DOM write methods BEFORE applying localization
                    const textContentDescriptor = Object.getOwnPropertyDescriptor(
                        Node.prototype, 'textContent',
                    )!;
                    const textContentSetter = vi.fn();
                    Object.defineProperty(element, 'textContent', {
                        get: textContentDescriptor.get!.bind(element),
                        set: textContentSetter,
                        configurable: true,
                    });

                    const setAttributeSpy = vi.spyOn(element, 'setAttribute');

                    // Apply localization with matching values already in place
                    const service = new LocalizationService();
                    await service.loadAndApply('en_US');

                    // Verify: no DOM write should have occurred for this element
                    if (attrType === 'data-i18n') {
                        expect(textContentSetter).not.toHaveBeenCalled();
                    } else if (attrType === 'data-i18n-placeholder') {
                        expect(setAttributeSpy).not.toHaveBeenCalledWith(
                            'placeholder', expect.anything(),
                        );
                    } else if (attrType === 'data-i18n-aria-label') {
                        expect(setAttributeSpy).not.toHaveBeenCalledWith(
                            'aria-label', expect.anything(),
                        );
                    } else if (attrType === 'data-i18n-title') {
                        expect(setAttributeSpy).not.toHaveBeenCalledWith(
                            'title', expect.anything(),
                        );
                    }
                },
            ),
            { numRuns: 100 },
        );
    }, 60_000);

    it('DOM write DOES occur when element value differs from target locale string', async () => {
        await fc.assert(
            fc.asyncProperty(
                i18nKeyArb,
                localeStringArb,
                localeStringArb,
                i18nAttrTypeArb,
                async (key, targetValue, differentValue, attrType) => {
                    // Ensure the current value differs from the target
                    const currentValue = differentValue === targetValue
                        ? `${differentValue}_different`
                        : differentValue;

                    // Setup: create a DOM element with a different current value
                    document.body.innerHTML = '';
                    const element = document.createElement('div');
                    element.setAttribute(attrType, key);

                    if (attrType === 'data-i18n') {
                        element.textContent = currentValue;
                    } else if (attrType === 'data-i18n-placeholder') {
                        element.setAttribute('placeholder', currentValue);
                    } else if (attrType === 'data-i18n-aria-label') {
                        element.setAttribute('aria-label', currentValue);
                    } else if (attrType === 'data-i18n-title') {
                        element.setAttribute('title', currentValue);
                    }

                    document.body.appendChild(element);

                    // Mock fetch to return locale strings with our key/targetValue
                    const menuPayload = { strings: { [key]: targetValue } };
                    globalThis.fetch = vi.fn().mockResolvedValue({
                        ok: true,
                        json: () => Promise.resolve(menuPayload),
                    });

                    // Apply localization with different value in place
                    const service = new LocalizationService();
                    await service.loadAndApply('en_US');

                    // Verify: a DOM write SHOULD have occurred (values were different)
                    if (attrType === 'data-i18n') {
                        expect(element.textContent).toBe(targetValue);
                    } else if (attrType === 'data-i18n-placeholder') {
                        expect(element.getAttribute('placeholder')).toBe(targetValue);
                    } else if (attrType === 'data-i18n-aria-label') {
                        expect(element.getAttribute('aria-label')).toBe(targetValue);
                    } else if (attrType === 'data-i18n-title') {
                        expect(element.getAttribute('title')).toBe(targetValue);
                    }
                },
            ),
            { numRuns: 100 },
        );
    }, 60_000);
});


/**
 * Property 22: Locale strings cached for page lifetime
 *
 * For any locale that has been loaded once, subsequent requests for the same
 * locale SHALL return from the in-memory cache without initiating a network fetch.
 *
 * **Validates: Requirements 8.3**
 */
describe('Property 22: Locale strings cached for page lifetime', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        document.body.innerHTML = '';
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    /**
     * Arbitrary generating a supported locale from the CONFIG.
     */
    const supportedLocaleArb = fc.constantFrom('en_US', 'id_ID', 'fr_FR');

    /**
     * Arbitrary generating a simple locale strings map.
     */
    const localeStringsArb = fc.dictionary(
        fc.string({ minLength: 1, maxLength: 15 }).filter((s) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s)),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        { minKeys: 1, maxKeys: 10 },
    );

    it('second loadAndApply for the same locale does not trigger a network fetch', async () => {
        await fc.assert(
            fc.asyncProperty(
                supportedLocaleArb,
                localeStringsArb,
                async (locale, strings) => {
                    document.body.innerHTML = '';

                    const menuPayload = { strings };
                    const fetchMock = vi.fn().mockResolvedValue({
                        ok: true,
                        json: () => Promise.resolve(menuPayload),
                    });
                    globalThis.fetch = fetchMock;

                    const service = new LocalizationService();

                    // First call — should trigger fetch(es)
                    await service.loadAndApply(locale);
                    const fetchCountAfterFirst = fetchMock.mock.calls.length;

                    // Second call — should be served entirely from cache
                    await service.loadAndApply(locale);
                    const fetchCountAfterSecond = fetchMock.mock.calls.length;

                    // No additional fetch calls should have been made for the same locale
                    expect(fetchCountAfterSecond).toBe(fetchCountAfterFirst);
                },
            ),
            { numRuns: 100 },
        );
    }, 60_000);

    it('different locales each trigger their own fetch, then subsequent calls use cache', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uniqueArray(supportedLocaleArb, { minLength: 2, maxLength: 3 }),
                localeStringsArb,
                async (locales, strings) => {
                    document.body.innerHTML = '';

                    const menuPayload = { strings };
                    const fetchMock = vi.fn().mockResolvedValue({
                        ok: true,
                        json: () => Promise.resolve(menuPayload),
                    });
                    globalThis.fetch = fetchMock;

                    const service = new LocalizationService();

                    // Load each locale once
                    for (const locale of locales) {
                        await service.loadAndApply(locale);
                    }
                    const fetchCountAfterAllFirstLoads = fetchMock.mock.calls.length;

                    // Load each locale again — all should be served from cache
                    for (const locale of locales) {
                        await service.loadAndApply(locale);
                    }
                    const fetchCountAfterAllSecondLoads = fetchMock.mock.calls.length;

                    // No additional fetches should have occurred
                    expect(fetchCountAfterAllSecondLoads).toBe(fetchCountAfterAllFirstLoads);
                },
            ),
            { numRuns: 100 },
        );
    }, 60_000);
});


/**
 * Property 14: LRU cache bounded at 500 entries
 *
 * For any sequence of unique HTML strings processed by the PopupLinkifier,
 * the cache size SHALL never exceed 500 entries. When a 501st unique entry
 * is inserted, the oldest entry SHALL be evicted.
 *
 * **Validates: Requirements 6.2, 7.3**
 */
describe('Property 14: LRU cache bounded at 500 entries', () => {
    // Capture the real createTreeWalker before any spies are set up
    const realCreateTreeWalker = document.createTreeWalker.bind(document);

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Helper: creates a PopupLinkifier with a regex-based linker and fills it
     * with `entryCount` unique cached entries using minimal HTML strings.
     * Uses safeHTML as passthrough (loaded via setup.ts) for speed.
     */
    function createFilledLinkifier(entryCount: number): InstanceType<typeof PopupLinkifier> {
        const localStateManager = new StateManager();
        const state = localStateManager.getState();

        // Use a simple regex matcher — XM is the shortest match token
        state.data.ruleLinkerRegex = /XM/g;
        state.data.titleLookup.set('xm', 'Action::XM');

        const linkifier = new (PopupLinkifier as unknown as new (
            sm: StateManager,
            fn: (id: string) => string,
        ) => InstanceType<typeof PopupLinkifier>)(
            localStateManager,
            (id: string) => id,
        );

        for (let i = 0; i < entryCount; i++) {
            linkifier.linkify(`<b>${i}XM</b>`);
        }

        return linkifier;
    }

    it('cache never exceeds 500 entries after inserting more than 500 unique strings', () => {
        // Use a single representative iteration to avoid timeout from 500+ DOMPurify calls × 100 runs.
        // The property is that regardless of how many entries exceed 500, the cache stays bounded.
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 100 }),
                (overflowCount) => {
                    vi.restoreAllMocks();

                    // Fill to exactly 500, then add overflowCount more
                    const linkifier = createFilledLinkifier(500 + overflowCount);

                    // Set up spy to verify cache hits/misses
                    let treeWalkerCallCount = 0;
                    vi.spyOn(document, 'createTreeWalker').mockImplementation(
                        (...args: Parameters<typeof document.createTreeWalker>) => {
                            treeWalkerCallCount++;
                            return realCreateTreeWalker(...args);
                        },
                    );

                    // The most recently inserted entry should be cached (cache hit)
                    linkifier.linkify(`<b>${499 + overflowCount}XM</b>`);
                    expect(treeWalkerCallCount).toBe(0);

                    // The entry at position 500-from-end should still be cached
                    treeWalkerCallCount = 0;
                    linkifier.linkify(`<b>${overflowCount}XM</b>`);
                    expect(treeWalkerCallCount).toBe(0);

                    // The oldest entry (index 0) should have been evicted (cache miss)
                    treeWalkerCallCount = 0;
                    linkifier.linkify(`<b>0XM</b>`);
                    expect(treeWalkerCallCount).toBe(1);
                },
            ),
            { numRuns: 100 },
        );
    }, 120_000);

    it('evicts oldest entry when 501st unique entry is inserted', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 50 }),
                (overflowCount) => {
                    vi.restoreAllMocks();

                    const linkifier = createFilledLinkifier(500);

                    // Insert `overflowCount` additional unique entries with different prefix
                    for (let i = 0; i < overflowCount; i++) {
                        linkifier.linkify(`<b>O${i}XM</b>`);
                    }

                    // Set up spy after all insertions to observe cache behavior
                    let treeWalkerCallCount = 0;
                    vi.spyOn(document, 'createTreeWalker').mockImplementation(
                        (...args: Parameters<typeof document.createTreeWalker>) => {
                            treeWalkerCallCount++;
                            return realCreateTreeWalker(...args);
                        },
                    );

                    // Verify that the most recent overflow entry is a cache hit
                    linkifier.linkify(`<b>O${overflowCount - 1}XM</b>`);
                    expect(treeWalkerCallCount).toBe(0);

                    // Verify that the first original entry (evicted) is a cache miss
                    treeWalkerCallCount = 0;
                    linkifier.linkify(`<b>0XM</b>`);
                    expect(treeWalkerCallCount).toBe(1);
                },
            ),
            { numRuns: 100 },
        );
    }, 120_000);
});


/**
 * Property 27: Theme manifest cached after first fetch
 *
 * For any number of calls to `loadAndPopulateThemes` after the first successful
 * fetch, zero additional network requests SHALL be made for `themes.json`.
 *
 * **Validates: Requirements 10.5**
 */
describe('Property 27: Theme manifest cached after first fetch', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        document.body.innerHTML = `<select id="${CONFIG.ELEMENT_IDS.THEME_SELECT}"></select>`;
        fetchSpy = vi.fn(async () => new Response(JSON.stringify({
            themes: [
                { id: 'original', displayName: 'Original' },
                { id: 'dark', displayName: 'Dark' },
            ],
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('fetch is called exactly once regardless of how many times loadAndPopulateThemes is invoked', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2, max: 10 }),
                async (callCount) => {
                    // Reset state for each iteration
                    fetchSpy.mockClear();
                    document.body.innerHTML = `<select id="${CONFIG.ELEMENT_IDS.THEME_SELECT}"></select>`;

                    const localStateManager = new StateManager();
                    localStateManager.getState().settings.theme = 'original';

                    const controller = new UIController(
                        {
                            get: (id: string) => document.getElementById(id) as HTMLElement,
                            queryAll: vi.fn(() => []),
                        } as never,
                        localStateManager,
                        {} as never,
                        {
                            viewRenderer: { applyAppearance: vi.fn() },
                            windowManager: {},
                        } as never,
                    );

                    // Call loadAndPopulateThemes `callCount` times sequentially
                    for (let i = 0; i < callCount; i++) {
                        await controller.loadAndPopulateThemes();
                    }

                    // Fetch should be called exactly once — only on the first invocation.
                    // All subsequent calls must use the cached manifest.
                    expect(fetchSpy).toHaveBeenCalledTimes(1);
                },
            ),
            { numRuns: 100 },
        );
    });
});



/**
 * Property 18: Previous locale cache entries survive for 5 minutes
 *
 * For any locale switch from locale A to locale B, data cache entries for locale A
 * SHALL remain accessible for 5 minutes after the switch, then be evicted from
 * the cache map.
 *
 * **Validates: Requirements 7.4**
 */
describe('Property 18: Previous locale cache entries survive for 5 minutes', () => {
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /**
     * Arbitrary that generates a locale switch scenario: two different locales
     * from the supported pool and a ruleset key.
     */
    const localeSwitchArb = fc.record({
        localeA: fc.constantFrom('en_US', 'id_ID', 'fr_FR'),
        localeB: fc.constantFrom('en_US', 'id_ID', 'fr_FR'),
        rulesetKey: fc.constantFrom('2014', '2024'),
    }).filter(({ localeA, localeB }) => localeA !== localeB);

    /**
     * Arbitrary for time elapsed after locale switch (in ms).
     * Tests values before and at the 5-minute boundary.
     */
    const timeBeforeTTLArb = fc.integer({ min: 0, max: FIVE_MINUTES_MS - 1 });
    const timeAtOrAfterTTLArb = fc.integer({ min: FIVE_MINUTES_MS, max: FIVE_MINUTES_MS + 60_000 });

    /**
     * Helper: creates a DataService with pre-populated cache for the given locale,
     * simulating data that has already been loaded. Returns the service and state manager.
     */
    function setupServiceWithCachedData(locale: string, rulesetKey: string) {
        const stateManager = new StateManager();
        const state = stateManager.getState();

        state.settings = {
            ...state.settings,
            locale,
            use2024Rules: rulesetKey === '2024',
        } as typeof state.settings;

        // Mock fetch — resolves synchronously with valid JSON data
        const mockRuleData = [{ title: `Rule from ${locale}`, bullets: [] }];
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve({
                ok: true,
                headers: new Headers({ 'content-type': 'application/json' }),
                json: () => Promise.resolve(mockRuleData),
            }),
        );

        const dataService = new DataService(stateManager);
        return { dataService, stateManager, state };
    }

    it('cache entries for previous locale remain accessible before 5-minute TTL expires', async () => {
        await fc.assert(
            fc.asyncProperty(
                localeSwitchArb,
                timeBeforeTTLArb,
                async ({ localeA, localeB, rulesetKey }, elapsedMs) => {
                    vi.clearAllTimers();

                    const { dataService, stateManager, state } = setupServiceWithCachedData(localeA, rulesetKey);

                    // Step 1: Load all data for locale A (populates internal cache)
                    await dataService.ensureAllDataLoadedForActiveRuleset();

                    const fetchCallsAfterLoad = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

                    // Step 2: Switch locale to B — triggers TTL scheduling for locale A entries
                    state.settings.locale = localeB;
                    stateManager.publish('settingChanged', { key: 'LOCALE', value: localeB });

                    // Step 3: Advance time by less than 5 minutes (within TTL)
                    vi.advanceTimersByTime(elapsedMs);

                    // Step 4: Switch back to locale A — cancel pending evictions for locale A
                    state.settings.locale = localeA;
                    stateManager.publish('settingChanged', { key: 'LOCALE', value: localeA });

                    // Step 5: Access data for locale A — should be served from cache
                    await dataService.ensureAllDataLoadedForActiveRuleset();

                    const fetchCallsAfterReAccess = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

                    // No new fetch calls — data was served from cache (still within TTL)
                    expect(fetchCallsAfterReAccess).toBe(fetchCallsAfterLoad);
                },
            ),
            { numRuns: 100 },
        );
    }, 120_000);

    it('cache entries for previous locale are evicted after 5-minute TTL expires', async () => {
        await fc.assert(
            fc.asyncProperty(
                localeSwitchArb,
                timeAtOrAfterTTLArb,
                async ({ localeA, localeB, rulesetKey }, elapsedMs) => {
                    vi.clearAllTimers();

                    const { dataService, stateManager, state } = setupServiceWithCachedData(localeA, rulesetKey);

                    // Step 1: Load all data for locale A (populates internal #dataCache)
                    await dataService.ensureAllDataLoadedForActiveRuleset();

                    // Step 2: Switch locale to B — triggers TTL scheduling for locale A entries
                    state.settings.locale = localeB;
                    stateManager.publish('settingChanged', { key: 'LOCALE', value: localeB });

                    // Step 3: Advance time past TTL (>= 5 minutes) — eviction timer fires
                    vi.advanceTimersByTime(elapsedMs);

                    // Step 4: Switch back to locale A
                    state.settings.locale = localeA;
                    stateManager.publish('settingChanged', { key: 'LOCALE', value: localeA });

                    // Step 5: Clear the loadedRulesets set so #loadDataFile doesn't short-circuit
                    // This simulates a fresh load requirement (the data no longer being in runtime state)
                    // We need this because loadedRulesets is a separate optimization that prevents
                    // re-fetching within the same session. We are testing that the *cache map* eviction
                    // occurred — not the loadedRulesets guard.
                    state.data.loadedRulesets[rulesetKey] = new Set();

                    // Step 6: Reset fetch mock to measure new fetches
                    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

                    // Step 7: Access data for locale A — should require new fetches
                    // because #dataCache entries have been evicted by the TTL timer
                    await dataService.ensureAllDataLoadedForActiveRuleset();

                    const fetchCallsAfterReAccess = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

                    // New fetch calls were made — data was evicted from cache map after TTL
                    expect(fetchCallsAfterReAccess).toBeGreaterThan(0);
                },
            ),
            { numRuns: 100 },
        );
    }, 120_000);
});


/**
 * Property 23: Benchmark warm-up excluded from measurement
 *
 * For any benchmark execution, the benchmarked function SHALL be called exactly
 * 11 times (1 warm-up + 10 measured), and the reported average SHALL be computed
 * from only the 10 measured iterations.
 *
 * **Validates: Requirements 9.6**
 */
describe('Property 23: Benchmark warm-up excluded from measurement', () => {
    it('benchmarked function is called exactly 11 times and avg computed from 10 measured', () => {
        fc.assert(
            fc.property(
                // Generate 10 random execution durations (positive ms) for measured iterations
                fc.array(
                    fc.double({ min: 0.01, max: 100, noNaN: true }),
                    { minLength: 10, maxLength: 10 },
                ),
                (measuredDurations) => {
                    let callCount = 0;
                    let measureIndex = 0;
                    let mockTime = 1000;
                    let callParity = 0; // 0 = start, 1 = end

                    const originalPerformanceNow = performance.now;

                    // The function under benchmark: counts calls
                    const benchFn = (): void => {
                        callCount++;
                    };

                    // Mock performance.now to return controlled timestamps.
                    // The harness calls performance.now() before and after each measured iteration.
                    performance.now = (): number => {
                        if (callParity === 0) {
                            callParity = 1;
                            return mockTime;
                        } else {
                            callParity = 0;
                            const elapsed = measuredDurations[measureIndex];
                            measureIndex++;
                            mockTime += elapsed;
                            return mockTime;
                        }
                    };

                    const result = runBenchmark(benchFn);

                    performance.now = originalPerformanceNow;

                    // Property: Function called exactly 11 times (1 warm-up + 10 measured)
                    expect(callCount).toBe(11);
                    expect(result.totalCalls).toBe(11);

                    // Property: Reported iterations array has exactly 10 entries
                    expect(result.iterations).toHaveLength(10);

                    // Property: The average equals the mean of the 10 measured iterations
                    const expectedAvg = result.iterations.reduce(
                        (sum: number, t: number) => sum + t, 0,
                    ) / 10;
                    expect(result.averageMs).toBeCloseTo(expectedAvg, 10);
                },
            ),
            { numRuns: 100 },
        );
    });

    it('warm-up execution time is excluded from the reported average', () => {
        fc.assert(
            fc.property(
                // Generate 10 small measured times to prove warm-up doesn't affect avg
                fc.array(
                    fc.double({ min: 0.1, max: 10, noNaN: true }),
                    { minLength: 10, maxLength: 10 },
                ),
                (measuredTimes) => {
                    let callCount = 0;
                    let mockTime = 0;
                    let measureIndex = 0;
                    let callParity = 0;
                    const originalPerformanceNow = performance.now;

                    const benchFn = (): void => {
                        callCount++;
                    };

                    performance.now = (): number => {
                        if (callParity === 0) {
                            callParity = 1;
                            return mockTime;
                        } else {
                            callParity = 0;
                            const elapsed = measuredTimes[measureIndex];
                            measureIndex++;
                            mockTime += elapsed;
                            return mockTime;
                        }
                    };

                    const result = runBenchmark(benchFn);

                    performance.now = originalPerformanceNow;

                    // The average should be based only on the 10 measured iterations.
                    // The warm-up call does not contribute to timing because performance.now
                    // is only invoked around the measured iterations (not during warm-up).
                    const expectedAvg = measuredTimes.reduce((sum, t) => sum + t, 0) / 10;
                    expect(result.averageMs).toBeCloseTo(expectedAvg, 5);

                    // Confirm 11 total calls regardless
                    expect(callCount).toBe(11);
                    expect(result.totalCalls).toBe(11);
                },
            ),
            { numRuns: 100 },
        );
    });
});



/**
 * Property 26: Fully-cached state resolves without network
 *
 * For any state where all data files for the active ruleset are present in the
 * DataService in-memory dataCache, calling `ensureAllDataLoadedForActiveRuleset`
 * SHALL resolve without initiating any network requests.
 *
 * **Validates: Requirements 10.4**
 */
describe('Property 26: Fully-cached state resolves without network', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    /**
     * Arbitrary generating a locale from the supported set.
     */
    const localeArb = fc.constantFrom(...CONFIG.LOCALE_CONFIG.SUPPORTED);

    /**
     * Arbitrary generating a boolean for the 2024 rules toggle (determines ruleset).
     */
    const use2024Arb = fc.boolean();

    /**
     * Arbitrary for a set of valid rule data entries that will be returned from "fetch".
     * Each data file gets 1-5 rule entries.
     */
    const ruleCountArb = fc.integer({ min: 1, max: 5 });

    it('resolves without fetch when all data files are already cached', async () => {
        await fc.assert(
            fc.asyncProperty(localeArb, use2024Arb, ruleCountArb, async (locale, use2024Rules, ruleCount) => {
                vi.restoreAllMocks();
                vi.unstubAllGlobals();

                const stateManager = new StateManager();
                const state = stateManager.getState();
                state.settings.locale = locale;
                state.settings.use2024Rules = use2024Rules;

                // Create mock rule data for each data file
                const mockRules = Array.from({ length: ruleCount }, (_, i) => ({
                    title: `Rule ${i}`,
                    description: `Description for rule ${i}`,
                }));

                // Mock fetch to return rule data (used during initial cache population)
                const fetchMock = vi.fn(async () => new Response(
                    JSON.stringify(mockRules),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ));
                vi.stubGlobal('fetch', fetchMock);

                const dataService = new DataService(stateManager);

                // Phase 1: Load all data files to populate the in-memory cache
                await dataService.ensureAllDataLoadedForActiveRuleset();

                // Verify all files were fetched during initial load
                expect(fetchMock).toHaveBeenCalledTimes(CONFIG.DATA_FILES.length);

                // Phase 2: Reset the fetch spy to track new calls
                fetchMock.mockClear();

                // Phase 3: Call ensureAllDataLoadedForActiveRuleset again — should resolve without fetch
                await dataService.ensureAllDataLoadedForActiveRuleset();

                // Property assertion: zero fetch calls when cache is complete
                expect(fetchMock).toHaveBeenCalledTimes(0);
            }),
            { numRuns: 100 },
        );
    }, 60_000);

    it('still fetches when cache is incomplete for a different ruleset', async () => {
        await fc.assert(
            fc.asyncProperty(localeArb, ruleCountArb, async (locale, ruleCount) => {
                vi.restoreAllMocks();
                vi.unstubAllGlobals();

                const stateManager = new StateManager();
                const state = stateManager.getState();
                state.settings.locale = locale;
                state.settings.use2024Rules = false;

                const mockRules = Array.from({ length: ruleCount }, (_, i) => ({
                    title: `Rule ${i}`,
                    description: `Description ${i}`,
                }));

                const fetchMock = vi.fn(async () => new Response(
                    JSON.stringify(mockRules),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ));
                vi.stubGlobal('fetch', fetchMock);

                const dataService = new DataService(stateManager);

                // Load all files for 2014 ruleset (cache populated for 2014 only)
                await dataService.ensureAllDataLoadedForActiveRuleset();
                expect(fetchMock).toHaveBeenCalledTimes(CONFIG.DATA_FILES.length);

                // Switch to 2024 ruleset — cache is NOT complete for this ruleset
                fetchMock.mockClear();
                state.settings.use2024Rules = true;
                await dataService.ensureAllDataLoadedForActiveRuleset();

                // Property assertion: fetch IS called because cache doesn't cover new ruleset
                expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
            }),
            { numRuns: 100 },
        );
    }, 60_000);
});
