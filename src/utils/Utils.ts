/* eslint-disable @typescript-eslint/no-explicit-any */
let trustedPolicy: any;
const _win = window as any;
if (_win.trustedTypes?.createPolicy) {
    try {
        trustedPolicy = _win.trustedTypes.createPolicy('default', {
            createHTML: (s: string) => s,
            createScriptURL: (s: string) => s,
            createScript: (s: string) => s,
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
