export class WakeLockService {
    #wakeLock: WakeLockSentinel | null = null;
    #isEnabled = false;

    constructor() {
        document.addEventListener('visibilitychange', () => {
            if (this.#wakeLock !== null && document.visibilityState === 'visible') {
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
        if (!this.#isEnabled || !('wakeLock' in navigator)) return;
        try {
            this.#wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
            console.warn('Wake Lock failed:', err);
        }
    }

    async #releaseLock(): Promise<void> {
        if (this.#wakeLock) {
            await this.#wakeLock.release();
            this.#wakeLock = null;
        }
    }
}
