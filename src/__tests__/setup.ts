import { beforeAll } from 'vitest';

// Pre-load DOMPurify for all tests that use safeHTML (which loads via dynamic import).
// This mirrors the application startup calling ensureDOMPurifyLoaded() before any
// rendering code executes.
// Skip in pure Node environments (e.g., service worker tests) where window is unavailable.
beforeAll(async () => {
    if (typeof window !== 'undefined') {
        const { ensureDOMPurifyLoaded } = await import('../utils/Utils.js');
        await ensureDOMPurifyLoaded();
    }
});
