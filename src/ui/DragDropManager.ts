import { CONFIG } from '../config.js';
import type { UserDataService } from '../services/UserDataService.js';

export class DragDropManager {
    #container: HTMLElement | null;
    #userDataService: UserDataService;
    #draggedItem: HTMLElement | null = null;

    constructor(containerId: string, userDataService: UserDataService) {
        this.#container = document.getElementById(containerId);
        this.#userDataService = userDataService;
        if (this.#container) this.#init();
    }

    #init(): void {
        this.#container!.addEventListener('dragstart', this.#handleDragStart);
        this.#container!.addEventListener('dragover', this.#handleDragOver);
        this.#container!.addEventListener('drop', this.#handleDrop);
        this.#container!.addEventListener('dragend', this.#handleDragEnd);
    }

    #handleDragStart = (e: Event): void => {
        const de = e as DragEvent;
        const item = (de.target as HTMLElement).closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        if (!item) return;
        this.#draggedItem = item;
        de.dataTransfer!.effectAllowed = 'move';
        de.dataTransfer!.setData('text/plain', item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID) || '');
        setTimeout(() => item.classList.add(CONFIG.CSS.IS_DRAGGING), 0);
    };

    #handleDragOver = (e: Event): void => {
        e.preventDefault();
        const target = (e.target as HTMLElement).closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        if (target && target !== this.#draggedItem) {
            target.classList.add(CONFIG.CSS.DRAG_OVER);
        }
    };

    #handleDrop = (e: Event): void => {
        e.preventDefault();
        const target = (e.target as HTMLElement).closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        if (target && this.#draggedItem && target !== this.#draggedItem) {
            const items = [...this.#container!.children];
            const fromIndex = items.indexOf(this.#draggedItem);
            const toIndex = items.indexOf(target);

            if (fromIndex < toIndex) {
                target.after(this.#draggedItem);
            } else {
                target.before(this.#draggedItem);
            }

            const newOrder = [...this.#container!.children].map((el) => el.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID) || '');
            this.#userDataService.updateFavoritesOrder(newOrder);
        }
        this.#cleanup();
    };

    #handleDragEnd = (): void => this.#cleanup();

    #cleanup(): void {
        if (this.#draggedItem) this.#draggedItem.classList.remove(CONFIG.CSS.IS_DRAGGING);
        this.#container!.querySelectorAll(`.${CONFIG.CSS.DRAG_OVER}`).forEach((el) => el.classList.remove(CONFIG.CSS.DRAG_OVER));
        this.#draggedItem = null;
    }
}
