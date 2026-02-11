interface NavigatorConnection {
    saveData?: boolean;
    effectiveType?: string;
}

export class PerformanceOptimizer {
    #isLowEnd = false;
    #isSaveData = false;

    constructor() {
        this.#checkHardware();
        this.#checkNetwork();
    }

    #checkHardware(): void {
        if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
            this.#isLowEnd = true;
        }
    }

    #checkNetwork(): void {
        const connection = (navigator as Navigator & { connection?: NavigatorConnection }).connection;
        if (connection) {
            if (connection.saveData || connection.effectiveType === '2g') {
                this.#isSaveData = true;
            }
        }
    }

    shouldReduceMotion(): boolean {
        return this.#isLowEnd || this.#isSaveData;
    }
}
