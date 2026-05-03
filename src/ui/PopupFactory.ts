import { CONFIG } from '../config.js';
import { debounce } from '../utils/Utils.js';
import type { UserDataService } from '../services/UserDataService.js';
import type { StateManager } from '../state/StateManager.js';
import type { TemplateService } from './TemplateService.js';
import type { RuleInfo } from '../types.js';

export class PopupFactory {
    #templateService: TemplateService;
    #userDataService: UserDataService;

    constructor(templateService: TemplateService, userDataService: UserDataService, _stateManager: StateManager) {
        this.#templateService = templateService;
        this.#userDataService = userDataService;
    }

    create(id: string, ruleInfo: RuleInfo, linkifyFn: (html: string) => string): HTMLElement {
        const popup = this.#templateService.createPopupElement(id, ruleInfo, linkifyFn, this.#userDataService.getNote);
        this.#attachNoteHandlers(popup, id);
        return popup;
    }

    #attachNoteHandlers(popup: HTMLElement, id: string): void {
        const textarea = popup.querySelector('.popup-notes-textarea') as HTMLTextAreaElement | null;
        const statusEl = popup.querySelector('.popup-notes-status') as HTMLElement | null;
        if (!textarea || !statusEl) return;

        let fadeTimeout: ReturnType<typeof setTimeout> | null = null;
        let saveVersion = 0;

        const debouncedSave = debounce(() => {
            const version = ++saveVersion;
            const text = textarea.value;
            void this.#userDataService.saveNote(id, text).then((saved) => {
                if (version !== saveVersion) return;
                statusEl.textContent = saved ? CONFIG.UI_STRINGS.NOTE_STATUS_SAVED : CONFIG.UI_STRINGS.NOTE_STATUS_FAILED;
                if (saved) {
                    fadeTimeout = setTimeout(() => {
                        if (statusEl.textContent === CONFIG.UI_STRINGS.NOTE_STATUS_SAVED) statusEl.textContent = '';
                    }, CONFIG.ANIMATION_DURATION.NOTE_FADEOUT_MS);
                }
            }).catch(() => {
                if (version === saveVersion) statusEl.textContent = CONFIG.UI_STRINGS.NOTE_STATUS_FAILED;
            });
        }, CONFIG.DEBOUNCE_DELAY.NOTE_AUTOSAVE_MS);

        textarea.addEventListener('input', () => {
            if (fadeTimeout) clearTimeout(fadeTimeout);
            statusEl.textContent = CONFIG.UI_STRINGS.NOTE_STATUS_SAVING;
            debouncedSave();
        });
    }
}
