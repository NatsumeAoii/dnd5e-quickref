import { CONFIG } from '../config.js';
import { debounce } from '../utils/Utils.js';
import type { UserDataService } from '../services/UserDataService.js';
import type { StateManager } from '../state/StateManager.js';
import type { TemplateService } from './TemplateService.js';
import type { RuleInfo } from '../types.js';

export class PopupFactory {
    #templateService: TemplateService;
    #userDataService: UserDataService;
    #stateManager: StateManager;

    constructor(templateService: TemplateService, userDataService: UserDataService, stateManager: StateManager) {
        this.#templateService = templateService;
        this.#userDataService = userDataService;
        this.#stateManager = stateManager;
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

        const debouncedSave = debounce(() => {
            this.#userDataService.saveNote(id, textarea.value);
            statusEl.textContent = CONFIG.UI_STRINGS.NOTE_STATUS_SAVED;
            const state = this.#stateManager.getState();
            state.ui.fadeTimeout = setTimeout(() => {
                if (statusEl.textContent === CONFIG.UI_STRINGS.NOTE_STATUS_SAVED) statusEl.textContent = '';
            }, CONFIG.ANIMATION_DURATION.NOTE_FADEOUT_MS);
        }, CONFIG.DEBOUNCE_DELAY.NOTE_AUTOSAVE_MS);

        textarea.addEventListener('input', () => {
            clearTimeout(this.#stateManager.getState().ui.fadeTimeout!);
            statusEl.textContent = CONFIG.UI_STRINGS.NOTE_STATUS_SAVING;
            debouncedSave();
        });
    }
}
