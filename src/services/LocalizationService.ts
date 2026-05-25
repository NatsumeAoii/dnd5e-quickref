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
        // #22: Single DOM pass for all i18n attributes instead of four separate queries
        document.querySelectorAll<HTMLElement>('[data-i18n], [data-i18n-placeholder], [data-i18n-aria-label], [data-i18n-title]').forEach((element) => {
            const i18nKey = element.dataset.i18n;
            if (i18nKey && strings[i18nKey]) element.textContent = strings[i18nKey];

            const placeholderKey = element.dataset.i18nPlaceholder;
            if (placeholderKey && strings[placeholderKey]) element.setAttribute('placeholder', strings[placeholderKey]);

            const ariaLabelKey = element.dataset.i18nAriaLabel;
            if (ariaLabelKey && strings[ariaLabelKey]) element.setAttribute('aria-label', strings[ariaLabelKey]);

            const titleKey = element.dataset.i18nTitle;
            if (titleKey && strings[titleKey]) element.setAttribute('title', strings[titleKey]);
        });
    }
}
