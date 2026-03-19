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
        if (this.#container) {
            this.#bind();
            this.#bindTouch();
        }
    }

    #bind(): void {
        this.#abortController = new AbortController();
        const opts: AddEventListenerOptions = { signal: this.#abortController.signal };
        this.#container!.addEventListener('dragstart', this.#handleDragStart, opts);
        this.#container!.addEventListener('dragover', this.#handleDragOver, opts);
        this.#container!.addEventListener('dragleave', this.#handleDragLeave, opts);
        this.#container!.addEventListener('drop', this.#handleDrop, opts);
        this.#container!.addEventListener('dragend', this.#handleDragEnd, opts);
        // Touch drag-and-drop — bound through the same signal so destroy() cleans it up
        this.#container!.addEventListener('pointerdown', this.#onPointerDown as EventListener, { signal: this.#abortController.signal, passive: false });
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

    // #10: Touch-based drag-and-drop via pointer events
    #touchDragItem: HTMLElement | null = null;
    #touchClone: HTMLElement | null = null;
    #touchOffsetX = 0;
    #touchOffsetY = 0;

    // Touch binding now handled inside #bind() via shared AbortController.
    #bindTouch(): void { /* no-op — kept for call-site compatibility */ }

    #onPointerDown = (e: PointerEvent): void => {
        if (e.pointerType !== 'touch' || !this.#container) return;
        const item = (e.target as HTMLElement).closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
        if (!item) return;

        // Delay activation to distinguish tap from drag
        const startX = e.clientX;
        const startY = e.clientY;
        let activated = false;

        const onMove = (me: PointerEvent) => {
            const dx = me.clientX - startX;
            const dy = me.clientY - startY;
            if (!activated && Math.abs(dx) + Math.abs(dy) < 10) return;

            if (!activated) {
                activated = true;
                this.#touchDragItem = item;
                item.classList.add(CONFIG.CSS.IS_DRAGGING);

                // Create visual clone
                const rect = item.getBoundingClientRect();
                this.#touchOffsetX = startX - rect.left;
                this.#touchOffsetY = startY - rect.top;
                this.#touchClone = item.cloneNode(true) as HTMLElement;
                this.#touchClone.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;opacity:0.8;z-index:99999;pointer-events:none;transition:none;`;
                document.body.appendChild(this.#touchClone);
            }

            if (this.#touchClone) {
                this.#touchClone.style.left = `${me.clientX - this.#touchOffsetX}px`;
                this.#touchClone.style.top = `${me.clientY - this.#touchOffsetY}px`;
            }

            // Highlight drop target
            const targetEl = document.elementFromPoint(me.clientX, me.clientY);
            const dropTarget = targetEl?.closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;
            this.#container!.querySelectorAll(`.${CONFIG.CSS.DRAG_OVER}`).forEach((el) => {
                if (el !== dropTarget) el.classList.remove(CONFIG.CSS.DRAG_OVER);
            });
            if (dropTarget && dropTarget !== this.#touchDragItem) {
                dropTarget.classList.add(CONFIG.CSS.DRAG_OVER);
            }
        };

        const cleanup = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onCancel);
        };

        const onUp = (ue: PointerEvent) => {
            cleanup();

            if (!activated || !this.#touchDragItem || !this.#container) {
                this.#touchCleanup();
                return;
            }

            const targetEl = document.elementFromPoint(ue.clientX, ue.clientY);
            const dropTarget = targetEl?.closest(`.${CONFIG.CSS.ITEM_CLASS}`) as HTMLElement | null;

            if (dropTarget && dropTarget !== this.#touchDragItem) {
                const items = [...this.#container.querySelectorAll(`.${CONFIG.CSS.ITEM_CLASS}`)];
                const fromIndex = items.indexOf(this.#touchDragItem);
                const toIndex = items.indexOf(dropTarget);
                if (fromIndex !== -1 && toIndex !== -1) {
                    if (fromIndex < toIndex) dropTarget.after(this.#touchDragItem);
                    else dropTarget.before(this.#touchDragItem);

                    const newOrder = [...this.#container.querySelectorAll(`.${CONFIG.CSS.ITEM_CLASS}`)].map(
                        (el) => el.getAttribute(CONFIG.ATTRIBUTES.POPUP_ID) ?? ''
                    ).filter(Boolean);
                    this.#userDataService.updateFavoritesOrder(newOrder);
                }
            }
            this.#touchCleanup();
        };

        const onCancel = () => {
            cleanup();
            this.#touchCleanup();
        };

        document.addEventListener('pointermove', onMove, { passive: false });
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onCancel);
    };

    #touchCleanup(): void {
        if (this.#touchDragItem) this.#touchDragItem.classList.remove(CONFIG.CSS.IS_DRAGGING);
        if (this.#touchClone) { this.#touchClone.remove(); this.#touchClone = null; }
        this.#container?.querySelectorAll(`.${CONFIG.CSS.DRAG_OVER}`).forEach((el) => el.classList.remove(CONFIG.CSS.DRAG_OVER));
        this.#touchDragItem = null;
    }
}
