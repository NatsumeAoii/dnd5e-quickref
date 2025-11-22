/* eslint-disable max-len */
/* eslint-disable no-console */

// --- Trusted Types Policy ---
let trustedPolicy;
if (window.trustedTypes && window.trustedTypes.createPolicy) {
  try {
    trustedPolicy = window.trustedTypes.createPolicy('default', {
      createHTML: (string) => string,
      createScriptURL: (string) => string,
      createScript: (string) => string,
    });
  } catch (e) { console.warn('Trusted Types policy creation failed:', e); }
}

export const safeHTML = (html) => (trustedPolicy ? trustedPolicy.createHTML(html) : html);
export const safeScriptURL = (url) => (trustedPolicy ? trustedPolicy.createScriptURL(url) : url);

export class DOMElementNotFoundError extends Error {
  constructor(elementId) { super(`Required DOM element with ID "${elementId}" was not found.`); this.name = 'DOMElementNotFoundError'; }
}

export class DataLoadError extends Error {
  constructor(src, details = '') { super(`Failed to load required data: ${src}. ${details}`); this.name = 'DataLoadError'; }
}

export const debounce = (func, delay) => {
  let timeoutId;
  return function debounced(...args) {
    const ctx = this;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(ctx, args), delay);
  };
};
