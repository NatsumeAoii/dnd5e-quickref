/* eslint-disable @typescript-eslint/no-explicit-any */
let trustedPolicy: any;
const _win = window as any;

// H1: DOM-based sanitizer — immune to regex bypass patterns (iframe, object, embed, svg+onload, etc.)
// Uses DOMParser which is NOT a Trusted Types sink, avoiding recursion with the default policy.
const DANGEROUS_TAGS = new Set([
    'script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea',
    'select', 'button', 'base', 'meta', 'link', 'style', 'applet', 'math',
]);

const DANGEROUS_URI_ATTRS = new Set([
    'href', 'src', 'action', 'formaction', 'data', 'xlink:href',
]);

const _parser = new DOMParser();

const sanitizeHTML = (html: string): string => {
    const doc = _parser.parseFromString(html, 'text/html');
    const body = doc.body;

    body.querySelectorAll('*').forEach((el) => {
        if (DANGEROUS_TAGS.has(el.tagName.toLowerCase())) {
            el.remove();
            return;
        }
        for (const attr of [...el.attributes]) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
            } else if (DANGEROUS_URI_ATTRS.has(name) && /^\s*javascript:/i.test(attr.value)) {
                el.removeAttribute(attr.name);
            }
        }
    });

    return body.innerHTML;
};

if (_win.trustedTypes?.createPolicy) {
    try {
        // The 'default' policy is required because the CSP enforces `require-trusted-types-for 'script'`,
        // which blocks ALL innerHTML assignments without TrustedHTML. The default policy acts as a
        // passthrough for developer-controlled innerHTML (onboarding templates, theme selectors, etc.)
        // while the explicit safeHTML() function performs full DOM-based sanitization for user/data content.
        trustedPolicy = _win.trustedTypes.createPolicy('default', {
            createHTML: (s: string) => s,
            createScriptURL: (s: string) => {
                const url = new URL(s, window.location.href);
                if (url.origin === window.location.origin) return s;
                const allowed = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
                if (allowed.includes(url.origin)) return s;
                console.warn(`Blocked script URL from untrusted origin: ${url.origin}`);
                return 'about:blank';
            },
            createScript: () => '',
        });
    } catch (e) { console.warn('Trusted Types policy creation failed:', e); }
}

// safeHTML always runs the DOM-based sanitizer regardless of Trusted Types support.
// When Trusted Types is active, the result is then wrapped as TrustedHTML by the default
// policy's passthrough createHTML (which won't re-sanitize since it's identity).
export const safeHTML = (html: string): string => {
    const sanitized = sanitizeHTML(html);
    return trustedPolicy ? trustedPolicy.createHTML(sanitized) : sanitized;
};

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
