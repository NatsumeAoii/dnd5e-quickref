export class WakeLockService {
    #wakeLock: WakeLockSentinel | null = null;
    #isEnabled = false;
    #pending: Promise<void> | null = null;

    constructor() {
        document.addEventListener('visibilitychange', () => {
            if (this.#isEnabled && document.visibilityState === 'visible') {
                this.#requestLock();
            }
        });
    }

    setEnabled(enabled: boolean): void {
        this.#isEnabled = enabled;
        if (enabled) this.#requestLock();
        else this.#releaseLock();
    }

    async #requestLock(): Promise<void> {
        if (!this.#isEnabled || !('wakeLock' in navigator) || this.#pending) return;
        this.#pending = (async () => {
            try {
                this.#wakeLock = await navigator.wakeLock.request('screen');
                // Clear stale reference when the browser releases the lock (e.g., tab hidden)
                this.#wakeLock.addEventListener('release', () => { this.#wakeLock = null; }, { once: true });
            } catch (err) {
                console.warn('Wake Lock failed:', err);
            } finally {
                this.#pending = null;
            }
        })();
        return this.#pending;
    }

    async #releaseLock(): Promise<void> {
        if (this.#wakeLock) {
            try {
                await this.#wakeLock.release();
            } catch { /* sentinel already released */ }
            this.#wakeLock = null;
        }
    }
}

