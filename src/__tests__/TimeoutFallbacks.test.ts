// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config.js';
import { StateManager } from '../state/StateManager.js';
import { ChangelogService } from '../services/ChangelogService.js';
import { ReadmeService } from '../services/ReadmeService.js';
import { LocalizationService } from '../services/LocalizationService.js';
import { UIController } from '../ui/UIController.js';

/**
 * Task 5.5 — Integration tests for timeout fallbacks (B2).
 *
 * The four data/markdown/theme boundaries now route through `fetchWithTimeout`
 * (Utils.ts), which wraps `fetch` in an `AbortController` + `setTimeout(abort, ≤10s)`.
 * For each boundary these tests simulate a hung (never-resolving) response that
 * rejects only when its abort signal fires, advance fake timers past the 10s bound,
 * and assert that:
 *   1. the request aborts within the bound (signal.aborted, never exceeding 10s),
 *   2. previous/cached state is retained (no wipe, fallback content present), and
 *   3. a load-failed indication is surfaced instead of an indefinite loading state.
 *
 * Requirements: 5.6
 */

const TIMEOUT_BOUND_MS = 10_000;

/**
 * Builds a `fetch` stub that never resolves on its own and rejects with an
 * `AbortError` the moment its `AbortSignal` fires. Captured signals let each test
 * assert the request was actually aborted within the bound.
 */
function createHungFetch(): { fetchStub: ReturnType<typeof vi.fn>; signals: AbortSignal[] } {
    const signals: AbortSignal[] = [];
    const fetchStub = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
            signals.push(signal);
            signal.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
        }
    }));
    return { fetchStub, signals };
}

const createA11yStub = () => ({ announce: vi.fn() });

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
});

describe('Timeout fallback — ChangelogService', () => {
    it('aborts a hung CHANGELOG fetch within the bound and surfaces the load-failed fallback', async () => {
        const { fetchStub, signals } = createHungFetch();
        vi.stubGlobal('fetch', fetchStub);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const service = new ChangelogService(createA11yStub() as never);

        let settled = false;
        const opened = service.open().then(() => { settled = true; });

        // Just below the bound: still loading, nothing aborted yet.
        await vi.advanceTimersByTimeAsync(TIMEOUT_BOUND_MS - 1);
        expect(settled).toBe(false);
        expect(signals[0]?.aborted).toBe(false);

        // Crossing the 10s bound triggers the abort.
        await vi.advanceTimersByTimeAsync(1);
        await opened;

        expect(settled).toBe(true);
        expect(signals[0]?.aborted).toBe(true);
        expect(fetchStub).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalled();

        // Load-failed indication surfaced (not an indefinite loading state).
        const modal = document.getElementById(CONFIG.ELEMENT_IDS.CHANGELOG_MODAL);
        expect(modal).not.toBeNull();
        expect(modal?.textContent).toContain('Could not load changelog');
        expect(service.isModalOpen).toBe(true);

        service.close();
    });

    it('retains the cached fallback so a re-open does not re-fetch', async () => {
        const { fetchStub } = createHungFetch();
        vi.stubGlobal('fetch', fetchStub);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const service = new ChangelogService(createA11yStub() as never);

        const opened = service.open();
        await vi.advanceTimersByTimeAsync(TIMEOUT_BOUND_MS);
        await opened;
        service.close();

        // Second open reuses the cached "could not load" block — no new fetch.
        const reopened = service.open();
        await vi.advanceTimersByTimeAsync(TIMEOUT_BOUND_MS);
        await reopened;

        expect(fetchStub).toHaveBeenCalledTimes(1);
        expect(document.getElementById(CONFIG.ELEMENT_IDS.CHANGELOG_MODAL)?.textContent)
            .toContain('Could not load changelog');
        service.close();
    });
});

describe('Timeout fallback — ReadmeService', () => {
    it('aborts a hung README fetch within the bound and surfaces the load-failed fallback', async () => {
        const { fetchStub, signals } = createHungFetch();
        vi.stubGlobal('fetch', fetchStub);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const service = new ReadmeService(createA11yStub() as never);

        let settled = false;
        const opened = service.open().then(() => { settled = true; });

        await vi.advanceTimersByTimeAsync(TIMEOUT_BOUND_MS - 1);
        expect(settled).toBe(false);
        expect(signals[0]?.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await opened;

        expect(settled).toBe(true);
        expect(signals[0]?.aborted).toBe(true);
        expect(fetchStub).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalled();

        const modal = document.getElementById(CONFIG.ELEMENT_IDS.README_MODAL);
        expect(modal).not.toBeNull();
        expect(modal?.textContent).toContain('Could not load README');
        expect(service.isModalOpen).toBe(true);

        service.close();
    });
});

describe('Timeout fallback — LocalizationService', () => {
    it('aborts a hung menu fetch within the bound and retains previous DOM strings', async () => {
        const { fetchStub, signals } = createHungFetch();
        vi.stubGlobal('fetch', fetchStub);
        const service = new LocalizationService();

        // Previously-applied i18n content that must survive a failed reload.
        document.body.innerHTML = '<span data-i18n="menu.title">Previous Title</span>';
        const labelEl = document.querySelector('[data-i18n]') as HTMLElement;

        let settled = false;
        let threw = false;
        const applied = service.loadAndApply(CONFIG.DEFAULTS.LOCALE)
            .then(() => { settled = true; })
            .catch(() => { threw = true; });

        await vi.advanceTimersByTimeAsync(TIMEOUT_BOUND_MS - 1);
        expect(settled).toBe(false);
        expect(signals[0]?.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await applied;

        // Aborts within bound, resolves gracefully (no hang, no throw).
        expect(signals[0]?.aborted).toBe(true);
        expect(settled).toBe(true);
        expect(threw).toBe(false);
        // Previous state retained — empty-string fallback never wipes existing content.
        expect(labelEl.textContent).toBe('Previous Title');
    });
});

describe('Timeout fallback — UIController theme manifest', () => {
    const createDeps = () => {
        const stateManager = new StateManager();
        stateManager.getState().settings = { theme: CONFIG.DEFAULTS.THEME } as never;

        const domProvider = {
            get: (id: string) => document.getElementById(id) as HTMLElement,
            query: (sel: string) => document.querySelector(sel),
            queryAll: (sel: string) => document.querySelectorAll(sel),
        };
        const viewRenderer = { applyAppearance: vi.fn() };
        const services = {
            a11y: { announce: vi.fn() },
            wakeLock: { setEnabled: vi.fn() },
            settings: {},
            localization: {},
            userData: {},
            data: {},
            navigation: {},
        };
        const components = { viewRenderer, windowManager: {} };
        return { stateManager, domProvider, viewRenderer, services, components };
    };

    it('aborts a hung theme-manifest fetch within the bound and surfaces the default fallback', async () => {
        const { fetchStub, signals } = createHungFetch();
        vi.stubGlobal('fetch', fetchStub);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        document.body.innerHTML = `<select id="${CONFIG.ELEMENT_IDS.THEME_SELECT}"></select>`;
        const { stateManager, domProvider, viewRenderer, services, components } = createDeps();
        const controller = new UIController(domProvider as never, stateManager, services as never, components as never);

        let settled = false;
        const loaded = controller.loadAndPopulateThemes().then(() => { settled = true; });

        await vi.advanceTimersByTimeAsync(TIMEOUT_BOUND_MS - 1);
        expect(settled).toBe(false);
        expect(signals[0]?.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await loaded;

        expect(settled).toBe(true);
        expect(signals[0]?.aborted).toBe(true);
        expect(fetchStub).toHaveBeenCalledTimes(1);

        // Load-failed indication surfaced; the select is repopulated with a usable
        // default rather than being left in an indefinite/empty loading state.
        expect(error).toHaveBeenCalledWith('Fatal: Could not load theme manifest.', expect.anything());
        const selectEl = document.getElementById(CONFIG.ELEMENT_IDS.THEME_SELECT) as HTMLSelectElement;
        expect(selectEl.options.length).toBe(1);
        expect(selectEl.value).toBe(CONFIG.DEFAULTS.THEME);
        // Previous/default theme state retained and re-applied.
        expect(stateManager.getState().settings.theme).toBe(CONFIG.DEFAULTS.THEME);
        expect(viewRenderer.applyAppearance).toHaveBeenCalled();
    });
});
