import { CONFIG } from '../config.js';
import type { UserDataService } from '../services/UserDataService.js';

export class DragDropManager {
    #container: HTMLElement | null;
    #userDataService: UserDataService;
    #draggedItem: HTMLElement | null = null;
    #abortController: AbortController | null = null;

    constructor(containerId: string, userDataService: UserDataService) {
        this.#container = document.getElementById(containerId);
        this.#userDataService = userDataService;
        if (this.#container) this.#bind();
    }

    #bind(): void {
        this.#abortController = new AbortController();
        const opts: AddEventListenerOptions = { signal: this.#abortController.signal };
        this.#container!.addEventListener('dragstart', this.#handleDragStart, opts);
        this.#container!.addEventListener('dragover', this.#handleDragOver, opts);
        this.#container!.addEventListener('dragleave', this.#handleDragLeave, opts);
        this.#container!.addEventListener('drop', this.#handleDrop, opts);
        this.#container!.addEventListener('dragend', this.#handleDragEnd, opts);
    }

    destroy(): void {
        this.#abortController?.abort();
        this.#abortController = null;
        this.#cleanup();
    }

    #handleDragStart = (e: Event): void => {
        const de = e as DragEvent;
        const item = (de.target as HTMLElement).closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        if (!item || !de.dataTransfer) return;
        this.#draggedItem = item;
        de.dataTransfer.effectAllowed = 'move';
        de.dataTransfer.setData('text/plain', item.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID) ?? '');
        requestAnimationFrame(() => item.classList.add(CONFIG.CSS.IS_DRAGGING));
    };

    #handleDragOver = (e: Event): void => {
        e.preventDefault();
        const de = e as DragEvent;
        if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
        const target = (e.target as HTMLElement).closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        if (!target || target === this.#draggedItem) return;

        this.#container!.querySelectorAll(`.${CONFIG.CSS.DRAG_OVER}`).forEach((el) => {
            if (el !== target) el.classList.remove(CONFIG.CSS.DRAG_OVER);
        });
        target.classList.add(CONFIG.CSS.DRAG_OVER);
    };

    #handleDragLeave = (e: Event): void => {
        const target = (e.target as HTMLElement).closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        if (target) target.classList.remove(CONFIG.CSS.DRAG_OVER);
    };

    #handleDrop = (e: Event): void => {
        e.preventDefault();
        const target = (e.target as HTMLElement).closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        if (!target || !this.#draggedItem || target === this.#draggedItem) {
            this.#cleanup();
            return;
        }

        const items = [...this.#container!.querySelectorAll(`.${CONFIG.CSS.ITEM_CLASS}`)];
        const fromIndex = items.indexOf(this.#draggedItem);
        const toIndex = items.indexOf(target);

        if (fromIndex === -1 || toIndex === -1) {
            this.#cleanup();
            return;
        }

        if (fromIndex < toIndex) {
            target.after(this.#draggedItem);
        } else {
            target.before(this.#draggedItem);
        }

        const newOrder = [...this.#container!.querySelectorAll(`.${CONFIG.CSS.ITEM_CLASS}`)].map(
            (el) => el.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID) ?? ''
        ).filter(Boolean);
        this.#userDataService.updateFavoritesOrder(newOrder);
        this.#cleanup();
    };

    #handleDragEnd = (): void => this.#cleanup();

    #cleanup(): void {
        if (this.#draggedItem) this.#draggedItem.classList.remove(CONFIG.CSS.IS_DRAGGING);
        this.#container?.querySelectorAll(`.${CONFIG.CSS.DRAG_OVER}`).forEach((el) => el.classList.remove(CONFIG.CSS.DRAG_OVER));
        this.#draggedItem = null;
    }
}
