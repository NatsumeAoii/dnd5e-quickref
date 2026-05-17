import { CONFIG } from '../config.js';

interface MenuPayload {
    locale?: string;
    strings?: Record<string, unknown>;
}

type MenuStrings = Record<string, string>;

const isSupportedLocale = (locale: string): boolean =>
    CONFIG.LOCALE_CONFIG.SUPPORTED.some((supportedLocale) => supportedLocale === locale);

export class LocalizationService {
    #cache = new Map<string, MenuStrings>();

    async loadAndApply(locale: string): Promise<void> {
        const strings = await this.#loadWithFallback(locale);
        this.#applyStrings(strings);
    }

    async #loadWithFallback(locale: string): Promise<MenuStrings> {
        const defaultStrings = await this.#loadMenu(CONFIG.DEFAULTS.LOCALE).catch(() => ({}));
        if (locale === CONFIG.DEFAULTS.LOCALE || !isSupportedLocale(locale)) return defaultStrings;
        const localizedStrings = await this.#loadMenu(locale).catch(() => ({}));
        return { ...defaultStrings, ...localizedStrings };
    }

    async #loadMenu(locale: string): Promise<MenuStrings> {
        const cached = this.#cache.get(locale);
        if (cached) return cached;

        const response = await fetch(`${CONFIG.LOCALE_CONFIG.PATH}${locale}/menu.json?v=${CONFIG.APP_VERSION}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as MenuPayload;
        const strings = this.#normalizeStrings(payload.strings);
        this.#cache.set(locale, strings);
        return strings;
    }

    #normalizeStrings(value: unknown): MenuStrings {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        );
    }

    #applyStrings(strings: MenuStrings): void {
        document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
            const key = element.dataset.i18n;
            if (key && strings[key]) element.textContent = strings[key];
        });
        document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((element) => {
            const key = element.dataset.i18nPlaceholder;
            if (key && strings[key]) element.setAttribute('placeholder', strings[key]);
        });
        document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
            const key = element.dataset.i18nAriaLabel;
            if (key && strings[key]) element.setAttribute('aria-label', strings[key]);
        });
        document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
            const key = element.dataset.i18nTitle;
            if (key && strings[key]) element.setAttribute('title', strings[key]);
        });
    }
}
