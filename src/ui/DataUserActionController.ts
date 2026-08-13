import { CONFIG } from '../config.js';
import type { DOMProvider } from '../services/DOMProvider.js';
import type { UserDataService } from '../services/UserDataService.js';
import type { A11yService } from '../services/A11yService.js';
import type { LocalizationService } from '../services/LocalizationService.js';
import type { WindowManager } from './WindowManager.js';

interface DataUserActionDeps {
    domProvider: DOMProvider;
    userData: UserDataService;
    a11y: A11yService;
    localization: LocalizationService;
    windowManager: WindowManager;
}

export class DataUserActionController {
    #deps: DataUserActionDeps;
    constructor(deps: DataUserActionDeps) { this.#deps = deps; }

    handleItemClick = (event: Event): void => {
        const target = event.target as HTMLElement;
        const item = target.closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        const id = item?.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID);
        if (!id) return;
        if (target.closest('.favorite-btn')) {
            this.#deps.userData.toggleFavorite(id);
            const favorite = this.#deps.userData.isFavorite(id);
            this.#deps.domProvider.queryAll(`[${CONFIG.ATTRIBUTES.POPUP_ID}="${id}"]`).forEach((element) => this.updateFavoriteButtonState(element as HTMLElement, favorite));
            this.#deps.a11y.announce(this.#deps.localization.translate(favorite ? 'favorite.added' : 'favorite.removed', favorite ? '{title} added to favorites.' : '{title} removed from favorites.', { title: id.split('::')[1] ?? id }));
        } else if (target.closest('.item-content') instanceof HTMLElement) this.#deps.windowManager.togglePopup(id);
    };

    handleItemKeydown = (event: Event): void => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
        const target = (keyboardEvent.target as HTMLElement).closest('.item-content');
        if (target instanceof HTMLElement) { keyboardEvent.preventDefault(); target.click(); }
    };

    updateFavoriteButtonState(item: HTMLElement, favorite: boolean): void {
        const button = item.querySelector('.favorite-btn') as HTMLButtonElement | null;
        if (!button) return;
        const title = item.querySelector('.item-title')?.textContent?.trim() || item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID)?.split('::')[1] || 'rule';
        const label = this.#deps.localization.translate(
            favorite ? 'favorite.remove' : 'favorite.add',
            favorite ? 'Remove {title} from favorites' : 'Add {title} to favorites',
            { title },
        );
        button.classList.toggle(CONFIG.CSS.IS_FAVORITED, favorite);
        button.setAttribute('aria-pressed', String(favorite));
        button.setAttribute('aria-label', label);
        button.title = label;
    }
}
