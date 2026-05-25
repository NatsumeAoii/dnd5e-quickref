export class ServiceWorkerMessenger {
    static #postMessage(message: { type: string; allowed?: boolean; locale?: string; ruleset?: string }): boolean {
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

    static clearCache(): boolean { return this.#postMessage({ type: 'CLEAR_CACHE' }); }

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
