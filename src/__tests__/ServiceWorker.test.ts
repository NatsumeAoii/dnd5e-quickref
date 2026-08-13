// @vitest-environment node
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { Script, createContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
};

const loadServiceWorkerInternals = () => {
    const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    const listeners: Record<string, (event: unknown) => void> = {};
    const clientsClaim = vi.fn();
    const context = createContext({
        URL,
        Response,
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        caches: { open: vi.fn(), keys: vi.fn() },
        fetch: vi.fn(),
        self: {
            registration: { scope: 'https://example.test/app/' },
            addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => { listeners[type] = handler; }),
            clients: { claim: clientsClaim },
            skipWaiting: vi.fn(),
        },
        __listeners: listeners,
        __clientsClaim: clientsClaim,
    });

    new Script(`${source}\n;globalThis.__swTest = { CACHE_NAME, CACHE_VERSION, isCoreAsset, getCacheMatchOptions: typeof getCacheMatchOptions === 'function' ? getCacheMatchOptions : undefined, get cachingAllowed() { return cachingAllowed; }, listeners: globalThis.__listeners, clientsClaim: globalThis.__clientsClaim };`).runInContext(context);
    return (context as {
        __swTest: {
            CACHE_NAME: string;
            CACHE_VERSION: string;
            isCoreAsset: (pathname: string) => boolean;
            getCacheMatchOptions?: (pathname: string) => CacheQueryOptions;
            cachingAllowed: boolean;
            listeners: Record<string, (event: unknown) => void>;
            clientsClaim: ReturnType<typeof vi.fn>;
        };
    }).__swTest;
};

describe('service worker stale-while-revalidate strategy', () => {
    it('serves data JSON from cache and revalidates in background when caching is enabled', async () => {
        const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
        const listeners: Record<string, (event: unknown) => void> = {};
        const cachedResponse = new Response(JSON.stringify([{ title: 'cached' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
        const networkResponse = new Response(JSON.stringify([{ title: 'fresh' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

        const cacheStore = new Map<string, Response>();
        const mockCache = {
            match: vi.fn(async (req: Request) => {
                const key = typeof req === 'string' ? req : req.url;
                return cacheStore.get(key) ?? undefined;
            }),
            put: vi.fn(async (req: Request, res: Response) => {
                const key = typeof req === 'string' ? req : req.url;
                cacheStore.set(key, res);
            }),
            add: vi.fn(async () => undefined),
            keys: vi.fn(async () => []),
            delete: vi.fn(async () => true),
        };

        const context = createContext({
            URL,
            Response,
            Request,
            Promise,
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
            caches: { open: vi.fn(async () => mockCache), keys: vi.fn(async () => []) },
            fetch: vi.fn(async () => networkResponse.clone()),
            self: {
                registration: { scope: 'https://example.test/app/' },
                addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => { listeners[type] = handler; }),
                clients: { claim: vi.fn(async () => undefined) },
                skipWaiting: vi.fn(async () => undefined),
            },
            setTimeout: globalThis.setTimeout,
        });

        new Script(source).runInContext(context);

        // Enable caching via SET_CACHING_POLICY message
        const msgEvent = {
            data: { type: 'SET_CACHING_POLICY', allowed: true, locale: 'en_US', ruleset: '2014' },
            waitUntil: vi.fn((p: Promise<unknown>) => p.catch(() => undefined)),
        };
        listeners.message(msgEvent);

        // Simulate a cached data JSON response
        const dataUrl = 'https://example.test/app/data/en_US/rules/data_action.json?v=1.1.8';
        cacheStore.set(dataUrl, cachedResponse.clone());

        // Issue a fetch for the data JSON
        let respondedWith: Response | undefined;
        const fetchEvent = {
            request: new Request(dataUrl, { method: 'GET' }),
            respondWith: vi.fn((responsePromise: Promise<Response>) => {
                responsePromise.then((r) => { respondedWith = r; });
            }),
        };

        listeners.fetch(fetchEvent);
        expect(fetchEvent.respondWith).toHaveBeenCalled();

        // Resolve the response promise
        await new Promise((r) => setTimeout(r, 10));

        // Should serve from cache (stale)
        expect(respondedWith).toBeDefined();
        const body = await respondedWith!.json();
        expect(body).toEqual([{ title: 'cached' }]);
    });

    it('falls back to network when no cached response exists', async () => {
        const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
        const listeners: Record<string, (event: unknown) => void> = {};
        const networkResponse = new Response(JSON.stringify([{ title: 'fresh' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

        const mockCache = {
            match: vi.fn(async () => undefined),
            put: vi.fn(async () => undefined),
            add: vi.fn(async () => undefined),
            keys: vi.fn(async () => []),
            delete: vi.fn(async () => true),
        };

        const context = createContext({
            URL,
            Response,
            Request,
            Promise,
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
            caches: { open: vi.fn(async () => mockCache), keys: vi.fn(async () => []) },
            fetch: vi.fn(async () => networkResponse.clone()),
            self: {
                registration: { scope: 'https://example.test/app/' },
                addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => { listeners[type] = handler; }),
                clients: { claim: vi.fn(async () => undefined) },
                skipWaiting: vi.fn(async () => undefined),
            },
            setTimeout: globalThis.setTimeout,
        });

        new Script(source).runInContext(context);

        // Enable caching
        listeners.message({
            data: { type: 'SET_CACHING_POLICY', allowed: true, locale: 'en_US', ruleset: '2014' },
            waitUntil: vi.fn((p: Promise<unknown>) => p.catch(() => undefined)),
        });

        // Issue fetch for uncached data
        const dataUrl = 'https://example.test/app/data/en_US/rules/data_action.json?v=1.1.8';
        let respondedWith: Response | undefined;
        const fetchEvent = {
            request: new Request(dataUrl, { method: 'GET' }),
            respondWith: vi.fn((responsePromise: Promise<Response>) => {
                responsePromise.then((r) => { respondedWith = r; });
            }),
        };

        listeners.fetch(fetchEvent);
        await new Promise((r) => setTimeout(r, 10));

        // Should fall back to network response
        expect(respondedWith).toBeDefined();
        const body = await respondedWith!.json();
        expect(body).toEqual([{ title: 'fresh' }]);
    });

    it('enables and disables caching based on SET_CACHING_POLICY message', () => {
        const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
        const listeners: Record<string, (event: unknown) => void> = {};

        const mockCache = {
            match: vi.fn(async () => undefined),
            put: vi.fn(async () => undefined),
            add: vi.fn(async () => undefined),
            keys: vi.fn(async () => []),
            delete: vi.fn(async () => true),
        };

        const context = createContext({
            URL,
            Response,
            Request,
            Promise,
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
            caches: { open: vi.fn(async () => mockCache), keys: vi.fn(async () => []) },
            fetch: vi.fn(async () => new Response('ok')),
            self: {
                registration: { scope: 'https://example.test/app/' },
                addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => { listeners[type] = handler; }),
                clients: { claim: vi.fn(async () => undefined) },
                skipWaiting: vi.fn(async () => undefined),
            },
            setTimeout: globalThis.setTimeout,
        });

        new Script(`${source}\n;globalThis.__sw = { get cachingAllowed() { return cachingAllowed; } };`).runInContext(context);
        const sw = (context as { __sw: { cachingAllowed: boolean } }).__sw;

        // Initially disabled
        expect(sw.cachingAllowed).toBe(false);

        // Enable
        listeners.message({
            data: { type: 'SET_CACHING_POLICY', allowed: true, locale: 'en_US', ruleset: '2014' },
            waitUntil: vi.fn((p: Promise<unknown>) => p.catch(() => undefined)),
        });
        expect(sw.cachingAllowed).toBe(true);

        // Disable
        listeners.message({
            data: { type: 'SET_CACHING_POLICY', allowed: false },
            waitUntil: vi.fn(),
        });
        expect(sw.cachingAllowed).toBe(false);
    });

    it('propagates CLEAR_CACHE request correlation on failure', async () => {
        const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
        const listeners: Record<string, (event: unknown) => void> = {};
        const postMessage = vi.fn();
        const context = createContext({
            URL,
            Response,
            Promise,
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
            caches: { open: vi.fn(async () => { throw new Error('clear failed'); }), keys: vi.fn(async () => []) },
            self: {
                registration: { scope: 'https://example.test/app/' },
                addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => { listeners[type] = handler; }),
                clients: { matchAll: vi.fn(async () => [{ postMessage }]), claim: vi.fn(), skipWaiting: vi.fn() },
            },
        });

        new Script(source).runInContext(context);
        let operation: Promise<unknown> | undefined;
        listeners.message({
            data: { type: 'CLEAR_CACHE', requestId: 'cache-clear-test' },
            waitUntil: vi.fn((promise: Promise<unknown>) => { operation = promise; }),
        });
        await operation;
        await Promise.resolve();

        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'CACHE_STATUS', status: 'error', errorCode: 'CACHE_CLEAR_FAILED', requestId: 'cache-clear-test',
        }));
    });

    it('does not delete unrelated origin caches during activation', async () => {
        const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
        const listeners: Record<string, (event: unknown) => void> = {};
        const deleteCache = vi.fn(async () => true);
        const context = createContext({
            URL, Response, Request, Promise,
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
            caches: { open: vi.fn(async () => ({ keys: vi.fn(async () => []), add: vi.fn(), match: vi.fn(), put: vi.fn(), delete: vi.fn() })), keys: vi.fn(async () => ['dnd5e-quickref-cache-v1.0.0', 'unrelated-cache']), delete: deleteCache },
            self: {
                registration: { scope: 'https://example.test/app/' },
                addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => { listeners[type] = handler; }),
                clients: { claim: vi.fn(async () => undefined) },
                skipWaiting: vi.fn(async () => undefined),
            },
        });
        new Script(`${source}`).runInContext(context);
        const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
        listeners.activate({ waitUntil });
        await waitUntil.mock.results[0]?.value;
        expect(deleteCache).toHaveBeenCalledWith('dnd5e-quickref-cache-v1.0.0');
        expect(deleteCache).not.toHaveBeenCalledWith('unrelated-cache');
    });
});

describe('service worker graceful fallback', () => {
    it('fetch handler ignores non-GET requests gracefully', () => {
        const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
        const listeners: Record<string, (event: unknown) => void> = {};

        const mockCache = {
            match: vi.fn(async () => undefined),
            put: vi.fn(async () => undefined),
            add: vi.fn(async () => undefined),
            keys: vi.fn(async () => []),
            delete: vi.fn(async () => true),
        };

        const context = createContext({
            URL,
            Response,
            Request,
            Promise,
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
            caches: { open: vi.fn(async () => mockCache), keys: vi.fn(async () => []) },
            fetch: vi.fn(async () => new Response('ok')),
            self: {
                registration: { scope: 'https://example.test/app/' },
                addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => { listeners[type] = handler; }),
                clients: { claim: vi.fn(async () => undefined) },
                skipWaiting: vi.fn(async () => undefined),
            },
            setTimeout: globalThis.setTimeout,
        });

        new Script(source).runInContext(context);

        // POST request should not be intercepted
        const respondWith = vi.fn();
        listeners.fetch({
            request: new Request('https://example.test/app/data/en_US/rules/data_action.json', { method: 'POST' }),
            respondWith,
        });

        expect(respondWith).not.toHaveBeenCalled();
    });

    it('fetch handler ignores non-http protocol requests', () => {
        const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
        const listeners: Record<string, (event: unknown) => void> = {};

        const mockCache = {
            match: vi.fn(async () => undefined),
            put: vi.fn(async () => undefined),
            add: vi.fn(async () => undefined),
            keys: vi.fn(async () => []),
            delete: vi.fn(async () => true),
        };

        const context = createContext({
            URL,
            Response,
            Request,
            Promise,
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
            caches: { open: vi.fn(async () => mockCache), keys: vi.fn(async () => []) },
            fetch: vi.fn(async () => new Response('ok')),
            self: {
                registration: { scope: 'https://example.test/app/' },
                addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => { listeners[type] = handler; }),
                clients: { claim: vi.fn(async () => undefined) },
                skipWaiting: vi.fn(async () => undefined),
            },
            setTimeout: globalThis.setTimeout,
        });

        new Script(source).runInContext(context);

        // Chrome extension request should not be intercepted
        const respondWith = vi.fn();
        listeners.fetch({
            request: { url: 'chrome-extension://abc/page.html', method: 'GET', mode: 'cors' },
            respondWith,
        });

        expect(respondWith).not.toHaveBeenCalled();
    });

    it('returns network error when both cache and network fail for data JSON', async () => {
        const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
        const listeners: Record<string, (event: unknown) => void> = {};

        const mockCache = {
            match: vi.fn(async () => undefined),
            put: vi.fn(async () => undefined),
            add: vi.fn(async () => undefined),
            keys: vi.fn(async () => []),
            delete: vi.fn(async () => true),
        };

        const context = createContext({
            URL,
            Response,
            Request,
            Promise,
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
            caches: { open: vi.fn(async () => mockCache), keys: vi.fn(async () => []) },
            fetch: vi.fn(async () => { throw new TypeError('NetworkError'); }),
            self: {
                registration: { scope: 'https://example.test/app/' },
                addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => { listeners[type] = handler; }),
                clients: { claim: vi.fn(async () => undefined) },
                skipWaiting: vi.fn(async () => undefined),
            },
            setTimeout: globalThis.setTimeout,
        });

        new Script(source).runInContext(context);

        const dataUrl = 'https://example.test/app/data/en_US/rules/data_action.json?v=1.1.8';
        let respondedWith: Response | undefined;
        listeners.fetch({
            request: new Request(dataUrl, { method: 'GET' }),
            respondWith: vi.fn((p: Promise<Response>) => { p.then((r) => { respondedWith = r; }); }),
        });

        await new Promise((r) => setTimeout(r, 10));

        // Response.error() returns a response with type 'error'
        expect(respondedWith).toBeDefined();
        expect(respondedWith!.type).toBe('error');
    });
});

describe('service worker cache policy', () => {
    it('does not emit debug logs in production', () => {
        const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

        expect(source).not.toMatch(/console\.(log|debug)\(/);
        expect(source).not.toContain('eslint-disable no-console');
    });

    it('uses the package app version for cache invalidation', () => {
        const sw = loadServiceWorkerInternals();

        expect(sw.CACHE_VERSION).toBe(packageJson.version);
        expect(sw.CACHE_NAME).toContain(packageJson.version);
    });

    it('does not treat every scoped path as a core asset', () => {
        const sw = loadServiceWorkerInternals();

        expect(sw.isCoreAsset('/app/')).toBe(true);
        expect(sw.isCoreAsset('/app/index.html')).toBe(true);
        expect(sw.isCoreAsset('/app/assets/index.js')).toBe(true);
        expect(sw.isCoreAsset('/app/data/en_US/rules/data_action.json')).toBe(false);
    });

    it('requires explicit app consent before non-core caching is allowed', () => {
        const sw = loadServiceWorkerInternals();

        expect(sw.cachingAllowed).toBe(false);
    });

    it('keeps version query strings for JSON cache matches but ignores them for immutable assets', () => {
        const sw = loadServiceWorkerInternals();

        expect(sw.getCacheMatchOptions).toBeTypeOf('function');
        expect(sw.getCacheMatchOptions?.('/app/data/en_US/rules/data_action.json')).toMatchObject({ ignoreSearch: false });
        expect(sw.getCacheMatchOptions?.('/app/assets/index.js')).toMatchObject({ ignoreSearch: false });
        expect(sw.getCacheMatchOptions?.('/app/img/run.webp')).toMatchObject({ ignoreSearch: true });
    });

    it('handles CLAIM messages by claiming clients', () => {
        const sw = loadServiceWorkerInternals();
        const event = {
            data: { type: 'CLAIM' },
            waitUntil: vi.fn((promise: Promise<unknown>) => promise),
        };

        sw.listeners.message(event);

        expect(event.waitUntil).toHaveBeenCalled();
        expect(sw.clientsClaim).toHaveBeenCalled();
    });
});
