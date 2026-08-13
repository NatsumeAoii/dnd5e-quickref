import { CONFIG } from '../config.js';
import { ServiceWorkerMessenger } from '../services/ServiceWorkerMessenger.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { StateManager } from '../state/StateManager.js';
import type { SettingsService } from '../services/SettingsService.js';
import type { LocalizationService } from '../services/LocalizationService.js';
import type { WakeLockService } from '../services/WakeLockService.js';
import type { DataService } from '../services/DataService.js';
import type { NavigationService } from '../services/NavigationService.js';
import type { A11yService } from '../services/A11yService.js';
import type { ViewRenderer } from './ViewRenderer.js';
import type { SectionCategoryController } from './SectionCategoryController.js';

type SupportedLocale = typeof CONFIG.LOCALE_CONFIG.SUPPORTED[number];

const isSupportedLocale = (locale: string): locale is SupportedLocale =>
    CONFIG.LOCALE_CONFIG.SUPPORTED.some((supportedLocale) => supportedLocale === locale);

interface SettingsTransitionDeps {
    domProvider: DOMProvider;
    stateManager: StateManager;
    settings: SettingsService;
    localization: LocalizationService;
    wakeLock: WakeLockService;
    data: DataService;
    navigation: NavigationService;
    a11y: A11yService;
    viewRenderer: ViewRenderer;
    sections: SectionCategoryController;
    closePopups: () => void;
    refreshFavorites: () => void;
}

export class SettingsTransitionController {
    #deps: SettingsTransitionDeps;
    #version = 0;
    #activeLocale: SupportedLocale = CONFIG.DEFAULTS.LOCALE;
    #activeRuleset = false;
    #unsubscribe: (() => void) | null = null;
    #handlerCleanup: (() => void)[] = [];

    constructor(deps: SettingsTransitionDeps) { this.#deps = deps; }

    initialize(): void {
        const settings = this.#deps.stateManager.getState().settings;
        if (isSupportedLocale(settings.locale)) this.#activeLocale = settings.locale;
        this.#activeRuleset = settings.use2024Rules;
        this.#unsubscribe = this.#deps.stateManager.subscribe('settingChanged', this.#handleSettingChange);
    }

    applyInitialSettings(): void {
        const { settings } = this.#deps.stateManager.getState();
        this.#deps.viewRenderer.applyAppearance(settings);
        this.#deps.viewRenderer.applyMotionReduction(settings.reduceMotion);
        this.#deps.wakeLock.setEnabled(settings.keepScreenOn);
    }

    setupHandlers(): void {
        this.#handlerCleanup.splice(0).forEach((cleanup) => cleanup());
        CONFIG.SETTINGS_CONFIG.forEach(({ id, key, stateProp, type }) => {
            try {
                const element = this.#deps.domProvider.get(id);
                const settings = this.#deps.stateManager.getState().settings;
                if (type === 'checkbox' && element instanceof HTMLInputElement) {
                    element.checked = settings[stateProp] as boolean;
                    const handleChange = (): void => this.#deps.settings.update(CONFIG.STORAGE_KEYS[key as keyof typeof CONFIG.STORAGE_KEYS], element.checked);
                    element.addEventListener('change', handleChange);
                    this.#handlerCleanup.push(() => element.removeEventListener('change', handleChange));
                } else if (type === 'select' && element instanceof HTMLSelectElement) {
                    element.value = settings[stateProp] as string;
                    const handleChange = (): void => this.#deps.settings.update(CONFIG.STORAGE_KEYS[key as keyof typeof CONFIG.STORAGE_KEYS], element.value);
                    element.addEventListener('change', handleChange);
                    this.#handlerCleanup.push(() => element.removeEventListener('change', handleChange));
                }
            } catch (error) { console.warn(`Failed to set up setting #${id}: ${(error as Error).message}`); }
        });
    }

    destroy(): void {
        this.#version++;
        this.#handlerCleanup.splice(0).forEach((cleanup) => cleanup());
        this.#unsubscribe?.();
        this.#unsubscribe = null;
    }

    #handleSettingChange = async (data?: unknown): Promise<void> => {
        if (!data || typeof data !== 'object') return;
        const { key, value } = data as { key: string; value: boolean | string };
        this.#deps.a11y.announce(this.#deps.localization.translate('settings.updated', 'Setting updated: {setting}.', { setting: key.toLowerCase().replace('_', ' ') }));
        const version = ++this.#version;
        try {
            if (key === 'RULES_2024') await this.#switchRuleset(version);
            else if (key === 'LOCALE') await this.#switchLocale(version);
        } catch (error) {
            if (version === this.#version) {
                console.warn('Setting transition failed:', error);
                this.#deps.viewRenderer.showNotification(
                    this.#deps.localization.translate('settings.transitionFailed', 'This setting could not be applied. Previous settings were restored.'),
                    'warning',
                );
            }
            return;
        }
        if (key === 'THEME' || key === 'MODE' || key === 'DENSITY') this.#deps.viewRenderer.applyAppearance(this.#deps.stateManager.getState().settings);
        else if (key === 'REDUCE_MOTION') this.#deps.viewRenderer.applyMotionReduction(value as boolean);
        else if (key === 'WAKE_LOCK') this.#deps.wakeLock.setEnabled(value as boolean);
        if ((key === 'RULES_2024' || key === 'LOCALE') && this.#version === version) {
            try {
                if (window.localStorage.getItem(CONFIG.STORAGE_KEYS.COOKIES_ACCEPTED) === 'true') {
                    const settings = this.#deps.stateManager.getState().settings;
                    ServiceWorkerMessenger.setCachingPolicy(true, settings.locale, settings.use2024Rules ? '2024' : '2014');
                }
            } catch { /* best effort */ }
        } else this.#deps.viewRenderer.filterRuleItems();
        this.#deps.navigation.invalidateFocusables();
    };

    async #switchRuleset(version: number): Promise<void> {
        const previous = this.#activeRuleset;
        this.#deps.stateManager.publish('transitionStarted', { kind: 'ruleset', version });
        this.#deps.closePopups();
        try {
            this.#deps.sections.markRuleMapDirty();
            await this.#deps.data.ensureAllDataLoadedForActiveRuleset();
            if (version !== this.#version) return;
            this.#deps.data.buildRuleMap();
            this.#deps.sections.consumeRuleMapDirty();
            this.#deps.data.buildLinkerData();
            this.#deps.refreshFavorites();
            await this.#deps.sections.renderOpenSections();
            this.#activeRuleset = this.#deps.stateManager.getState().settings.use2024Rules;
            this.#deps.stateManager.publish('transitionCompleted', { kind: 'ruleset', version });
        } catch (error) {
            if (version === this.#version) {
                this.#deps.settings.restore(CONFIG.STORAGE_KEYS.RULES_2024, previous);
                this.#activeRuleset = previous;
                this.#deps.stateManager.publish('transitionFailed', { kind: 'ruleset', version });
                throw error;
            }
        }
    }

    async #switchLocale(version: number): Promise<void> {
        const configuredLocale = this.#deps.stateManager.getState().settings.locale;
        if (!isSupportedLocale(configuredLocale)) return;
        const locale = configuredLocale;
        const previous = this.#activeLocale;
        this.#deps.stateManager.publish('transitionStarted', { kind: 'locale', version });
        try { await this.#deps.localization.loadAndApply(locale); }
        catch (error) {
            if (version === this.#version) {
                this.#deps.settings.restore(CONFIG.STORAGE_KEYS.LOCALE, previous);
                this.#activeLocale = previous;
                this.#deps.stateManager.publish('transitionFailed', { kind: 'locale', version });
                throw error;
            }
            return;
        }
        if (version !== this.#version) return;
        try {
            await this.#switchRuleset(version);
        } catch (error) {
            if (version !== this.#version) return;
            this.#deps.settings.restore(CONFIG.STORAGE_KEYS.LOCALE, previous);
            await this.#deps.localization.loadAndApply(previous);
            if (version !== this.#version) return;
            this.#activeLocale = previous;
            this.#deps.stateManager.publish('transitionFailed', { kind: 'locale', version });
            throw error;
        }
        if (version !== this.#version) return;
        this.#activeLocale = locale;
        this.#deps.stateManager.publish('transitionCompleted', { kind: 'locale', version });
    }
}
