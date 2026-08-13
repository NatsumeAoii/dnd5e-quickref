export class ServiceWorkerMessenger {
    static #listeners = new Set<(status: CacheStatusMessage) => void>();
    static #messageListenerInstalled = false;

    static #postMessage(message: { type: string; allowed?: boolean; locale?: string; ruleset?: string; requestId?: string }): boolean {
        if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return false;
        try {
            navigator.serviceWorker.controller.postMessage(message);
            return true;
        } catch (e) {
            console.warn('Service worker postMessage failed:', e);
            return false;
        }
    }

    static setCachingPolicy(allowed: boolean, locale = 'en_US', ruleset = '2014'): boolean {
        return this.#postMessage({ type: 'SET_CACHING_POLICY', allowed, locale, ruleset });
    }

    static clearCache(): boolean { return this.#postMessage({ type: 'CLEAR_CACHE', requestId: this.#requestId() }); }

    static refreshCache(locale: string, ruleset: '2014' | '2024'): boolean {
        return this.#postMessage({ type: 'REFRESH_CACHE', locale, ruleset, requestId: this.#requestId() });
    }

    static retryCache(locale: string, ruleset: '2014' | '2024'): boolean { return this.refreshCache(locale, ruleset); }

    static activateUpdate(): boolean { return this.#postMessage({ type: 'SKIP_WAITING', requestId: this.#requestId() }); }

    static #requestId(): string { return `cache-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

    static subscribeStatus(listener: (status: CacheStatusMessage) => void): () => void {
        this.#listeners.add(listener);
        if (!this.#messageListenerInstalled && 'serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', this.#handleMessage);
            this.#messageListenerInstalled = true;
        }
        return () => this.#listeners.delete(listener);
    }

    static getStatus(): boolean { return this.#postMessage({ type: 'GET_CACHE_STATUS' }); }

    static #handleMessage = (event: MessageEvent<unknown>): void => {
        const value = event.data;
        if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { type?: unknown }).type !== 'CACHE_STATUS') return;
        const status = value as CacheStatusMessage;
        if (!['unsupported', 'disabled', 'starting', 'ready', 'refreshing', 'error'].includes(status.status)) return;
        this.#listeners.forEach((listener) => listener(status));
    };

    static async #withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
            return await Promise.race([
                promise,
                new Promise<null>((resolve) => {
                    timeoutId = setTimeout(() => resolve(null), timeoutMs);
                }),
            ]);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

    static async ensureServiceWorkerReady(timeoutMs = 3000): Promise<boolean> {
        if (!('serviceWorker' in navigator)) return false;
        try {
            const reg = await this.#withTimeout(navigator.serviceWorker.ready, timeoutMs);
            if (!reg) return false;
            if (navigator.serviceWorker.controller) return true;
            if (!reg.active) return false;

            try {
                reg.active.postMessage({ type: 'CLAIM' });
            } catch (e) {
                console.warn('Service worker claim message failed:', e);
                return false;
            }

            await this.#withTimeout(new Promise<void>((resolve) => {
                if (navigator.serviceWorker.controller) { resolve(); return; }
                navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
            }), Math.min(timeoutMs, 1000));
            return Boolean(navigator.serviceWorker.controller);
        } catch (e) {
            console.warn('Service worker readiness failed:', e);
            return false;
        }
    }
}

export interface CacheStatusMessage {
    type: 'CACHE_STATUS';
    status: 'unsupported' | 'disabled' | 'starting' | 'ready' | 'refreshing' | 'error';
    locale?: string;
    ruleset?: '2014' | '2024';
    cachedCount?: number;
    totalCount?: number;
    errorCode?: 'PRECACHE_FAILED' | 'CACHE_CLEAR_FAILED';
    requestId?: string;
    file?: string;
    fileIndex?: number;
    totalBytes?: number;
    lastSuccessfulCacheAt?: string;
}
