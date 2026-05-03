/* eslint-disable @typescript-eslint/no-explicit-any */
let trustedPolicy: any;
const _win = window as any;

const sanitizeHTML = (html: string): string => {
    const safeTags = new Set([
        'a', 'b', 'br', 'code', 'em', 'i', 'kbd', 'li', 'ol', 'p', 's', 'span',
        'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
    ]);
    const voidTags = new Set(['br']);
    const allowedProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:']);
    const escapeAttr = (value: string): string => value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const fromCodePointSafe = (value: number): string =>
        Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
    const decodeUrlEntities = (value: string): string => value
        .replace(/&#(\d+);?/g, (_m, code: string) => fromCodePointSafe(Number(code)))
        .replace(/&#x([0-9a-f]+);?/gi, (_m, code: string) => fromCodePointSafe(parseInt(code, 16)))
        .replace(/&(colon|tab|newline);?/gi, (_m, entity: string) => {
            const normalized = entity.toLowerCase();
            if (normalized === 'colon') return ':';
            if (normalized === 'tab') return '\t';
            return '\n';
        });
    const isSafeUrl = (value: string): boolean => {
        const trimmed = decodeUrlEntities(value).trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;
        try {
            return allowedProtocols.has(new URL(trimmed, window.location.href).protocol);
        } catch {
            return false;
        }
    };
    const isAllowedAttr = (tag: string, name: string, value: string): boolean => {
        if (tag === 'a') {
            if (name === 'href') return isSafeUrl(value);
            if (name === 'class') return /^[\w -]{1,80}$/.test(value);
            if (name === 'data-popup-id') return value.length <= 200 && !/[<>"`]/.test(value);
            if (name === 'title') return value.length <= 200;
            if (name === 'target') return value === '_blank' || value === '_self';
            if (name === 'rel') return /^[\w -]{1,120}$/.test(value);
        }
        if ((tag === 'td' || tag === 'th') && (name === 'colspan' || name === 'rowspan')) {
            const numeric = Number(value);
            return Number.isInteger(numeric) && numeric > 0 && numeric <= 20;
        }
        return false;
    };
    const sanitizeAttrs = (tag: string, attrs: string): string => {
        const safeAttrs: string[] = [];
        attrs.replace(
            /\s+([A-Za-z_:][\w:.-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g,
            (_match: string, rawName: string, rawValue = '') => {
                const name = rawName.toLowerCase();
                if (name.startsWith('on') || name === 'style') return '';
                const value = rawValue[0] === '"' || rawValue[0] === "'"
                    ? rawValue.slice(1, -1)
                    : rawValue;
                if (rawValue && isAllowedAttr(tag, name, value)) {
                    safeAttrs.push(`${name}="${escapeAttr(value)}"`);
                }
                return '';
            },
        );
        return safeAttrs.length > 0 ? ` ${safeAttrs.join(' ')}` : '';
    };

    let clean = html
        .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi, '')
        .replace(/<\/?\s*(script|style|iframe|object|embed|link|meta|base)\b[^>]*>/gi, '');

    clean = clean.replace(/<\/?\s*([A-Za-z][\w:-]*)([^>]*)>/g, (match: string, rawTag: string, rawAttrs: string) => {
        const tag = rawTag.toLowerCase();
        if (!safeTags.has(tag)) return '';
        if (/^<\s*\//.test(match)) return voidTags.has(tag) ? '' : `</${tag}>`;
        return voidTags.has(tag) ? `<${tag}>` : `<${tag}${sanitizeAttrs(tag, rawAttrs)}>`;
    });

    return clean;
};

if (_win.trustedTypes?.createPolicy) {
    try {
        trustedPolicy = _win.trustedTypes.createPolicy('default', {
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
    trustedPolicy ? trustedPolicy.createHTML(html) : sanitizeHTML(html);

export const safeScriptURL = (url: string): string =>
    trustedPolicy ? trustedPolicy.createScriptURL(url) : url;

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export const getFocusableElements = (root: ParentNode): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) =>
        !el.hidden && el.getAttribute('aria-hidden') !== 'true'
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
