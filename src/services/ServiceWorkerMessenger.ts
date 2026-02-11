export class ServiceWorkerMessenger {
    static #postMessage(message: { type: string; allowed?: boolean }): void {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage(message);
        }
    }

    static setCachingPolicy(allowed: boolean): void { this.#postMessage({ type: 'SET_CACHING_POLICY', allowed }); }

    static clearCache(): void { this.#postMessage({ type: 'CLEAR_CACHE' }); }

    static async ensureServiceWorkerReady(): Promise<void> {
        if (!('serviceWorker' in navigator)) return;
        const reg = await navigator.serviceWorker.ready;
        if (reg.active && !navigator.serviceWorker.controller) {
            await reg.active.postMessage({ type: 'CLAIM' });
            await new Promise<void>((resolve) => {
                if (navigator.serviceWorker.controller) { resolve(); return; }
                navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
                setTimeout(resolve, 1000);
            });
        }
    }
}
