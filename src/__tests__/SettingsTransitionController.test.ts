// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config.js';
import { StateManager } from '../state/StateManager.js';
import { SettingsTransitionController } from '../ui/SettingsTransitionController.js';

describe('SettingsTransitionController handler lifecycle', () => {
    it('removes setting control listeners on destroy and avoids duplicates on reinitialization', () => {
        document.body.innerHTML = '<input id="optional-switch" type="checkbox">';
        const stateManager = new StateManager();
        stateManager.getState().settings = {
            showOptional: false,
            showHomebrew: false,
            use2024Rules: false,
            locale: 'en_US',
            theme: 'original',
            darkMode: false,
            reduceMotion: false,
            keepScreenOn: false,
            density: 'normal',
        };
        const update = vi.fn();
        const element = document.getElementById('optional-switch') as HTMLInputElement;
        const controller = new SettingsTransitionController({
            domProvider: { get: (id: string) => document.getElementById(id) ?? (() => { throw new Error(id); })() } as never,
            stateManager,
            settings: { update } as never,
            localization: { translate: (_key: string, fallback: string) => fallback } as never,
            wakeLock: { setEnabled: vi.fn() } as never,
            data: {} as never,
            navigation: { invalidateFocusables: vi.fn() } as never,
            a11y: { announce: vi.fn() } as never,
            viewRenderer: {} as never,
            sections: {} as never,
            closePopups: vi.fn(),
            refreshFavorites: vi.fn(),
        });

        controller.setupHandlers();
        controller.destroy();
        element.dispatchEvent(new Event('change'));
        expect(update).not.toHaveBeenCalled();

        controller.setupHandlers();
        controller.setupHandlers();
        element.checked = true;
        element.dispatchEvent(new Event('change'));
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(CONFIG.STORAGE_KEYS.OPTIONAL, true);
    });

    it('restores the previous locale strings when the ruleset transition fails', async () => {
        const stateManager = new StateManager();
        stateManager.getState().settings = {
            showOptional: false,
            showHomebrew: false,
            use2024Rules: false,
            locale: 'en_US',
            theme: 'original',
            darkMode: false,
            reduceMotion: false,
            keepScreenOn: false,
            density: 'normal',
        };
        const loadAndApply = vi.fn(async () => undefined);
        const ensureAllDataLoadedForActiveRuleset = vi.fn(async () => { throw new Error('data load failed'); });
        const restore = vi.fn((key: string, value: boolean | string) => {
            const state = stateManager.getState().settings;
            if (key === CONFIG.STORAGE_KEYS.LOCALE) state.locale = value as string;
            if (key === CONFIG.STORAGE_KEYS.RULES_2024) state.use2024Rules = value as boolean;
        });
        const controller = new SettingsTransitionController({
            domProvider: {} as never,
            stateManager,
            settings: { restore } as never,
            localization: { loadAndApply, translate: (_key: string, fallback: string) => fallback } as never,
            wakeLock: { setEnabled: vi.fn() } as never,
            data: { ensureAllDataLoadedForActiveRuleset } as never,
            navigation: { invalidateFocusables: vi.fn() } as never,
            a11y: { announce: vi.fn() } as never,
            viewRenderer: { showNotification: vi.fn() } as never,
            sections: { markRuleMapDirty: vi.fn() } as never,
            closePopups: vi.fn(),
            refreshFavorites: vi.fn(),
        });
        controller.initialize();

        stateManager.getState().settings.locale = 'id_ID';
        const transitionFailed = vi.fn();
        stateManager.subscribe('transitionFailed', transitionFailed);
        stateManager.publish('settingChanged', { key: 'LOCALE', value: 'id_ID' });
        await vi.waitFor(() => expect(transitionFailed).toHaveBeenCalled());

        expect(loadAndApply).toHaveBeenNthCalledWith(1, 'id_ID');
        expect(loadAndApply).toHaveBeenNthCalledWith(2, 'en_US');
        expect(stateManager.getState().settings.locale).toBe('en_US');
        expect(stateManager.getState().settings.use2024Rules).toBe(false);
        expect(transitionFailed).toHaveBeenCalledWith({ kind: 'locale', version: 1 });
    });
});
