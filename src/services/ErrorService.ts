type ErrorLevel = 'warn' | 'error' | 'fatal';

interface ErrorEntry {
    level: ErrorLevel;
    message: string;
    context?: string;
    timestamp: number;
    stack?: string;
}

type NotifyFn = (message: string, level: string) => void;

export class ErrorService {
    #log: ErrorEntry[] = [];
    #maxLogSize = 50;
    #notifyFn: NotifyFn | null = null;

    setNotifier(fn: NotifyFn): void { this.#notifyFn = fn; }

    report(error: unknown, context?: string, level: ErrorLevel = 'error'): void {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        const entry: ErrorEntry = { level, message, context, timestamp: Date.now(), stack };

        this.#log.push(entry);
        if (this.#log.length > this.#maxLogSize) this.#log.shift();

        const prefix = context ? `[${context}]` : '';

        if (level === 'warn') {
            console.warn(`${prefix} ${message}`);
        } else {
            console.error(`${prefix} ${message}`, stack || '');
        }

        if (level === 'fatal') {
            this.#notifyFn?.(message, 'error');
        } else if (level === 'error' && this.#notifyFn) {
            this.#notifyFn(`${prefix} ${message}`, 'error');
        }
    }

    warn(message: string, context?: string): void { this.report(message, context, 'warn'); }

    getLog(): readonly ErrorEntry[] { return this.#log; }

    getLastError(): ErrorEntry | undefined { return this.#log.at(-1); }

    clear(): void { this.#log.length = 0; }

    formatForReport(): string {
        return this.#log.map((e) =>
            `[${new Date(e.timestamp).toISOString()}] [${e.level.toUpperCase()}]${e.context ? ` [${e.context}]` : ''} ${e.message}`
        ).join('\n');
    }
}
