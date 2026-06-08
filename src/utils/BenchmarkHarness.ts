/**
 * BenchmarkHarness — Measures execution time of a function using
 * 1 warm-up iteration + 10 measured iterations, reporting the
 * average of the measured iterations.
 *
 * The warm-up iteration excludes JIT compilation and initialization
 * overhead from the results. The reported average is computed from
 * only the 10 measured iterations.
 */

export interface BenchmarkResult {
    /** Average execution time in milliseconds (from 10 measured iterations) */
    averageMs: number;
    /** Individual measured iteration durations in milliseconds */
    iterations: number[];
    /** Total number of times the function was called (warm-up + measured) */
    totalCalls: number;
}

const WARMUP_ITERATIONS = 1;
const MEASURED_ITERATIONS = 10;

/**
 * Runs a benchmark against the provided function.
 *
 * 1. Executes the function once as a warm-up (untimed).
 * 2. Executes the function 10 times, measuring each iteration.
 * 3. Computes and returns the average of the 10 measured iterations.
 *
 * @param fn - The function to benchmark. Called exactly 11 times total.
 * @returns BenchmarkResult with average, individual iterations, and total call count.
 */
export function runBenchmark(fn: () => void): BenchmarkResult {
    // Warm-up iteration (untimed)
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        fn();
    }

    // Measured iterations
    const iterations: number[] = [];
    for (let i = 0; i < MEASURED_ITERATIONS; i++) {
        const start = performance.now();
        fn();
        const end = performance.now();
        iterations.push(end - start);
    }

    const averageMs = iterations.reduce((sum, t) => sum + t, 0) / iterations.length;

    return {
        averageMs,
        iterations,
        totalCalls: WARMUP_ITERATIONS + MEASURED_ITERATIONS,
    };
}

/**
 * Asserts a benchmark result against a threshold and reports diagnostics on failure.
 *
 * @param result - The benchmark result to check.
 * @param thresholdMs - Maximum acceptable average execution time in milliseconds.
 * @param label - A descriptive label for the benchmark (used in error messages).
 * @throws Error with measured avg, threshold, and percentage over-budget on failure.
 */
export function assertBenchmark(result: BenchmarkResult, thresholdMs: number, label: string): void {
    if (result.averageMs > thresholdMs) {
        const percentOver = ((result.averageMs - thresholdMs) / thresholdMs * 100).toFixed(1);
        throw new Error(
            `[Benchmark FAILED] ${label}: ` +
            `measured ${result.averageMs.toFixed(2)}ms avg, ` +
            `threshold ${thresholdMs}ms, ` +
            `${percentOver}% over budget`,
        );
    }
}

export { WARMUP_ITERATIONS, MEASURED_ITERATIONS };
