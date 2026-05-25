import DOMPurify from 'dompurify';

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

const sanitizeHTML = (html: string): string =>
    DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ALLOWED_URI_REGEXP,
    }) as string;

if (trustedTypes?.createPolicy) {
    try {
        trustedPolicy = trustedTypes.createPolicy('default', {
            createHTML: (s: string) => sanitizeHTML(s),
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

export const safeHTML = (html: string): string =>
    trustedPolicy ? String(trustedPolicy.createHTML(html)) : sanitizeHTML(html);

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
