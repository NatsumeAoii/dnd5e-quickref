import type * as DOMPurifyNamespace from 'dompurify';

interface TrustedTypesPolicyLike {
    createHTML: (input: string) => unknown;
    createScriptURL: (input: string) => unknown;
}

interface TrustedTypesLike {
    createPolicy: (
        name: string,
        rules: {
            createHTML: (input: string) => string;
            createScriptURL: (input: string) => string;
            createScript: () => string;
        },
    ) => TrustedTypesPolicyLike;
}

let trustedPolicy: TrustedTypesPolicyLike | undefined;
const trustedTypes = (window as Window & { trustedTypes?: TrustedTypesLike }).trustedTypes;

// #18: DOMPurify-based sanitizer replaces the custom regex-based implementation
const ALLOWED_TAGS = [
    'a', 'b', 'br', 'code', 'em', 'i', 'kbd', 'li', 'ol', 'p', 's', 'span',
    'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
];
const ALLOWED_ATTR = [
    'href', 'class', 'data-popup-id', 'title', 'target', 'rel',
    'colspan', 'rowspan', 'scope',
];
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

// DOMPurify is loaded via dynamic import() on first safeHTML() call and cached for subsequent use.
// This keeps DOMPurify out of the main entry chunk (Requirement 2.1). The module shape is
// referenced via a top-level `import type` so no `import()` type annotation is needed.
type DOMPurifyModule = typeof DOMPurifyNamespace;
let cachedDOMPurify: DOMPurifyModule | null = null;
let domPurifyLoadPromise: Promise<DOMPurifyModule> | null = null;

async function loadDOMPurify(): Promise<DOMPurifyModule> {
    if (cachedDOMPurify) return cachedDOMPurify;
    if (!domPurifyLoadPromise) {
        domPurifyLoadPromise = import('dompurify').then((mod) => {
            cachedDOMPurify = mod;
            return mod;
        });
    }
    return domPurifyLoadPromise;
}

function sanitizeHTMLSync(html: string): string {
    if (!cachedDOMPurify) {
        throw new Error('DOMPurify not loaded. Call ensureDOMPurifyLoaded() or safeHTML() first.');
    }
    return cachedDOMPurify.default.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ALLOWED_URI_REGEXP,
    }) as string;
}

if (trustedTypes?.createPolicy) {
    try {
        trustedPolicy = trustedTypes.createPolicy('default', {
            createHTML: (s: string) => sanitizeHTMLSync(s),
            createScriptURL: (s: string) => {
                const url = new URL(s, window.location.href);
                if (url.origin === window.location.origin) return s;
                // Allow known CDN origins (Google Fonts, etc.)
                const allowed = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
                if (allowed.includes(url.origin)) return s;
                console.warn(`Blocked script URL from untrusted origin: ${url.origin}`);
                return 'about:blank';
            },
            createScript: () => '',
        });
    } catch (e) { console.warn('Trusted Types policy creation failed:', e); }
}

/**
 * Ensures DOMPurify is loaded and cached. Call this before any synchronous safeHTML usage.
 * After this resolves, safeHTML can be called synchronously.
 */
export async function ensureDOMPurifyLoaded(): Promise<void> {
    await loadDOMPurify();
}

/**
 * Sanitizes HTML using DOMPurify. DOMPurify is loaded via dynamic import on first call
 * and cached for all subsequent calls. After the first await resolves, the function
 * operates synchronously from the cache.
 */
export const safeHTML = (html: string): string => {
    if (!cachedDOMPurify) {
        throw new Error('DOMPurify not loaded. Call ensureDOMPurifyLoaded() before using safeHTML().');
    }
    return trustedPolicy ? String(trustedPolicy.createHTML(html)) : sanitizeHTMLSync(html);
};

export const safeScriptURL = (url: string): string =>
    trustedPolicy ? String(trustedPolicy.createScriptURL(url)) : url;

export const prefersReducedMotion = (): boolean =>
    document.body.classList.contains('motion-reduced') ||
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

export const getMotionSafeScrollBehavior = (): ScrollBehavior =>
    prefersReducedMotion() ? 'auto' : 'smooth';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export const getFocusableElements = (root: ParentNode): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) =>
        el.tabIndex >= 0 &&
        !el.closest('[hidden], [aria-hidden="true"], [inert]')
    );

export const trapFocusWithin = (event: KeyboardEvent, root: ParentNode): void => {
    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements(root);
    if (focusable.length === 0) {
        event.preventDefault();
        return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!focusable.includes(active as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
};

export const installPrintRestoreFallback = (restore: () => void, timeoutMs = 1500): (() => void) => {
    let restored = false;
    const mediaQuery = window.matchMedia?.('print');
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const restoreOnce = (): void => {
        if (restored) return;
        restored = true;
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        window.removeEventListener('afterprint', restoreOnce);
        mediaQuery?.removeEventListener?.('change', handlePrintMediaChange);
        restore();
    };

    const handlePrintMediaChange = (event: MediaQueryListEvent): void => {
        if (!event.matches) restoreOnce();
    };

    window.addEventListener('afterprint', restoreOnce, { once: true });
    mediaQuery?.addEventListener?.('change', handlePrintMediaChange);
    timeoutId = setTimeout(restoreOnce, timeoutMs);

    return restoreOnce;
};

export class DOMElementNotFoundError extends Error {
    constructor(elementId: string) {
        super(`Required DOM element with ID "${elementId}" was not found.`);
        this.name = 'DOMElementNotFoundError';
    }
}

export class DataLoadError extends Error {
    constructor(src: string, details = '') {
        super(`Failed to load required data: ${src}. ${details}`);
        this.name = 'DataLoadError';
    }
}

export const debounce = <T extends (...args: unknown[]) => void>(func: T, delay: number): ((...args: Parameters<T>) => void) => {
    let timeoutId: ReturnType<typeof setTimeout>;
    return function debounced(this: unknown, ...args: Parameters<T>) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
};

/**
 * Performs a `fetch` bounded by an explicit timeout. Centralizes the
 * `AbortController` + `setTimeout(abort, ms)` + `clearTimeout` pattern so every
 * data, markdown, and theme boundary shares one contract (Requirements 5.5, 6.1, 6.2).
 *
 * The effective timeout is capped at 10 seconds so a stalled request always settles
 * within that bound. On timeout the request is aborted and the returned promise
 * rejects with the abort error, letting callers retain their previous state instead
 * of hanging indefinitely.
 *
 * @param url - The resource to fetch.
 * @param timeoutMs - Requested timeout in milliseconds (capped at 10000). Defaults to 10000.
 * @param init - Optional `RequestInit`; its `signal` is overridden by the internal controller.
 * @returns The `Response` when the request completes before the timeout.
 */
export async function fetchWithTimeout(
    url: string,
    timeoutMs = 10_000,
    init?: RequestInit,
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 10_000));
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}
