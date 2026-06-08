/**
 * Web Vitals Reporter — Dynamically imports the `web-vitals` library in
 * production mode only and passes LCP, CLS, and INP metrics to a
 * caller-provided callback.
 *
 * In non-production environments, the function is a no-op to avoid loading
 * the library unnecessarily during development.
 */

export type MetricCallback = (metric: { name: string; value: number; id: string }) => void;

/**
 * Reports Core Web Vitals (LCP, CLS, INP) to the provided callback.
 * Only activates in production mode — returns immediately in development.
 */
export function reportWebVitals(callback: MetricCallback): void {
    if (!isProductionMode()) {
        return;
    }

    if (typeof callback !== 'function') {
        return;
    }

    import('web-vitals').then(({ onLCP, onCLS, onINP }) => {
        onLCP(callback);
        onCLS(callback);
        onINP(callback);
    }).catch((error: unknown) => {
        console.warn('[webVitals] Failed to load web-vitals library:', error);
    });
}

function isProductionMode(): boolean {
    try {
        const meta = import.meta as unknown as { env?: { PROD?: boolean; MODE?: string } };
        return meta.env?.PROD === true || meta.env?.MODE === 'production';
    } catch {
        return false;
    }
}
