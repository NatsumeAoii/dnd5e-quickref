/* eslint-disable @typescript-eslint/no-explicit-any */
let trustedPolicy: any;
const _win = window as any;

const sanitizeHTML = (html: string): string => {
    // Strip <script> blocks (including content)
    let clean = html.replace(/<script[\s>][\s\S]*?<\/script>/gi, '');
    // Strip standalone <script> tags (unclosed)
    clean = clean.replace(/<\/?script[^>]*>/gi, '');
    // Strip on* event handler attributes (e.g., onerror="...", onclick='...')
    clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    // Strip javascript: URIs in href/src/action attributes
    clean = clean.replace(/(href|src|action)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '$1=""');
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
    trustedPolicy ? trustedPolicy.createHTML(html) : html;

export const safeScriptURL = (url: string): string =>
    trustedPolicy ? trustedPolicy.createScriptURL(url) : url;

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
        const ctx = this;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(ctx, args), delay);
    };
};
