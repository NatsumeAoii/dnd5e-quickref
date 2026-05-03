// @vitest-environment node
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { Script, createContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

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

    new Script(`${source}\n;globalThis.__swTest = { isCoreAsset, getCacheMatchOptions: typeof getCacheMatchOptions === 'function' ? getCacheMatchOptions : undefined, get cachingAllowed() { return cachingAllowed; }, listeners: globalThis.__listeners, clientsClaim: globalThis.__clientsClaim };`).runInContext(context);
    return (context as {
        __swTest: {
            isCoreAsset: (pathname: string) => boolean;
            getCacheMatchOptions?: (pathname: string) => CacheQueryOptions;
            cachingAllowed: boolean;
            listeners: Record<string, (event: unknown) => void>;
            clientsClaim: ReturnType<typeof vi.fn>;
        };
    }).__swTest;
};

describe('service worker cache policy', () => {
    it('does not treat every scoped path as a core asset', () => {
        const sw = loadServiceWorkerInternals();

        expect(sw.isCoreAsset('/app/')).toBe(true);
        expect(sw.isCoreAsset('/app/index.html')).toBe(true);
        expect(sw.isCoreAsset('/app/assets/index.js')).toBe(true);
        expect(sw.isCoreAsset('/app/js/data/data_action.json')).toBe(false);
    });

    it('requires explicit app consent before non-core caching is allowed', () => {
        const sw = loadServiceWorkerInternals();

        expect(sw.cachingAllowed).toBe(false);
    });

    it('keeps version query strings for JSON cache matches but ignores them for immutable assets', () => {
        const sw = loadServiceWorkerInternals();

        expect(sw.getCacheMatchOptions).toBeTypeOf('function');
        expect(sw.getCacheMatchOptions?.('/app/js/data/data_action.json')).toMatchObject({ ignoreSearch: false });
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
