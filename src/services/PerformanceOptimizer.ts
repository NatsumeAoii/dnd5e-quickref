interface NavigatorConnection {
    saveData?: boolean;
    effectiveType?: string;
    addEventListener?: (type: 'change', listener: () => void) => void;
    removeEventListener?: (type: 'change', listener: () => void) => void;
}

export class PerformanceOptimizer {
    #isLowEnd = false;
    #isSaveData = false;
    #connection: NavigatorConnection | undefined;
    #handleConnectionChange = (): void => this.#checkNetwork();

    constructor() {
        this.#checkHardware();
        this.#connection = (navigator as Navigator & { connection?: NavigatorConnection }).connection;
        this.#checkNetwork();
        this.#connection?.addEventListener?.('change', this.#handleConnectionChange);
    }

    #checkHardware(): void {
        if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
            this.#isLowEnd = true;
        }
    }

    #checkNetwork(): void {
        const connection = this.#connection;
        this.#isSaveData = false;
        if (connection) {
            if (connection.saveData || connection.effectiveType === '2g') {
                this.#isSaveData = true;
            }
        }
    }

    shouldReduceMotion(): boolean {
        return this.#isLowEnd || this.#isSaveData
            || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    }

    destroy(): void {
        this.#connection?.removeEventListener?.('change', this.#handleConnectionChange);
    }
}
