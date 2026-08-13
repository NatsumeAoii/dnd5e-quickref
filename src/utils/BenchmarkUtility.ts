/**
 * BenchmarkUtility — Records startup milestone timestamps and computes
 * per-phase and total durations for the critical startup path.
 *
 * Uses the Performance API (performance.mark / performance.measure) when
 * available, falling back to Date.now()-based timestamps otherwise.
 * In development mode, logs a formatted summary table to the console when
 * the final milestone ("appVisible") is reached.
 */

export interface StartupMetrics {
    domContentLoaded: number;  // ms from navigation start to DOMContentLoaded
    dataLoaded: number;        // ms duration of data loading phase
    firstSectionRendered: number; // ms duration of render phase
    appVisible: number;        // ms duration of final show phase
    total: number;             // ms total startup time
}

type Milestone = 'domContentLoaded' | 'dataLoaded' | 'firstSectionRendered' | 'appVisible';

const MARK_PREFIX = 'quickref:';

interface MilestoneRecord {
    name: Milestone;
    timestamp: number;
    performanceMark?: string;
}

export class BenchmarkUtilityImpl {
    #records: MilestoneRecord[] = [];
    #hasPerformanceAPI: boolean;
    #warningEmitted = false;

    constructor() {
        this.#hasPerformanceAPI = typeof performance !== 'undefined'
            && typeof performance.mark === 'function'
            && typeof performance.measure === 'function'
            && typeof performance.now === 'function';

        if (!this.#hasPerformanceAPI && !this.#warningEmitted) {
            this.#warningEmitted = true;
            console.warn(
                '[BenchmarkUtility] Performance API is unavailable. ' +
                'Falling back to Date.now() — measurements will have reduced precision.',
            );
        }
    }

    /**
     * Record a startup milestone. Milestones must be called in order but
     * the utility is tolerant of repeated calls for the same milestone
     * (last-write wins).
     */
    mark(milestone: Milestone): void {
        const markName = `${MARK_PREFIX}${milestone}`;
        let timestamp: number;

        if (this.#hasPerformanceAPI) {
            performance.mark(markName);
            timestamp = performance.now();
        } else {
            timestamp = Date.now();
        }

        const existing = this.#records.find((r) => r.name === milestone);
        if (existing) {
            existing.timestamp = timestamp;
            existing.performanceMark = this.#hasPerformanceAPI ? markName : undefined;
        } else {
            this.#records.push({
                name: milestone,
                timestamp,
                performanceMark: this.#hasPerformanceAPI ? markName : undefined,
            });
        }

        // Log summary when the final milestone is reached in development mode
        if (milestone === 'appVisible' && this.#isDevelopmentMode()) {
            this.#logSummary();
        }
    }

    /**
     * Returns computed startup metrics with per-phase durations and total.
     * Phases are computed as differences between consecutive milestone timestamps.
     * If milestones have not been recorded yet, durations default to 0.
     */
    getMetrics(): StartupMetrics {
        const getTimestamp = (name: Milestone): number | undefined =>
            this.#records.find((r) => r.name === name)?.timestamp;

        const t0 = getTimestamp('domContentLoaded');
        const t1 = getTimestamp('dataLoaded');
        const t2 = getTimestamp('firstSectionRendered');
        const t3 = getTimestamp('appVisible');

        // domContentLoaded = time from navigation start (or 0 if using Date.now fallback)
        let domContentLoaded = 0;
        if (t0 !== undefined) {
            if (this.#hasPerformanceAPI) {
                // performance.now() is relative to navigation start
                domContentLoaded = t0;
            } else {
                // Date.now() — report as the raw timestamp offset from first mark (self-referential)
                domContentLoaded = t0;
            }
        }

        // Per-phase durations as differences between consecutive milestones
        const dataLoaded = (t0 !== undefined && t1 !== undefined) ? Math.max(0, t1 - t0) : 0;
        const firstSectionRendered = (t1 !== undefined && t2 !== undefined) ? Math.max(0, t2 - t1) : 0;
        const appVisible = (t2 !== undefined && t3 !== undefined) ? Math.max(0, t3 - t2) : 0;

        // Total = last milestone minus first milestone
        const total = (t0 !== undefined && t3 !== undefined) ? Math.max(0, t3 - t0) : 0;

        return {
            domContentLoaded,
            dataLoaded,
            firstSectionRendered,
            appVisible,
            total,
        };
    }

    #isDevelopmentMode(): boolean {
        try {
            // Vite injects import.meta.env at build time
            const meta = import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } };
            return meta.env?.DEV === true || meta.env?.MODE === 'development';
        } catch {
            // Fallback for environments without import.meta.env
            return false;
        }
    }

    #logSummary(): void {
        const metrics = this.getMetrics();

        console.info(
            '%c[Startup Performance]',
            'color: #4CAF50; font-weight: bold;',
        );
        console.info({
            'DOMContentLoaded': { 'Duration (ms)': metrics.domContentLoaded.toFixed(2) },
            'Data Loaded': { 'Duration (ms)': metrics.dataLoaded.toFixed(2) },
            'First Section Rendered': { 'Duration (ms)': metrics.firstSectionRendered.toFixed(2) },
            'App Visible': { 'Duration (ms)': metrics.appVisible.toFixed(2) },
            'Total': { 'Duration (ms)': metrics.total.toFixed(2) },
        });
    }
}

/** Singleton instance of the benchmark utility */
export const benchmarkUtility = new BenchmarkUtilityImpl();

export type { Milestone };
