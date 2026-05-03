export class WakeLockService {
    #wakeLock: WakeLockSentinel | null = null;
    #isEnabled = false;
    #pending: Promise<void> | null = null;
    #handleRelease = (): void => {
        this.#wakeLock = null;
    };

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
        if (!this.#isEnabled || !('wakeLock' in navigator) || this.#pending || this.#wakeLock) return;
        this.#pending = (async () => {
            try {
                this.#wakeLock = await navigator.wakeLock.request('screen');
                this.#wakeLock.addEventListener('release', this.#handleRelease, { once: true });
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
            const lock = this.#wakeLock;
            this.#wakeLock = null;
            try {
                await lock.release();
            } catch (err) {
                console.warn('Wake Lock release failed:', err);
            }
        }
    }
}
