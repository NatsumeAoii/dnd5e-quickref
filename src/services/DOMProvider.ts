import { DOMElementNotFoundError } from '../utils/Utils.js';

export class DOMProvider {
    get(id: string): HTMLElement {
        const el = document.getElementById(id);
        if (!el) throw new DOMElementNotFoundError(id);
        return el;
    }

    getTemplate(id: string): HTMLTemplateElement {
        const tpl = this.get(id);
        if (!(tpl instanceof HTMLTemplateElement)) throw new TypeError(`Element "${id}" is not a <template>.`);
        return tpl;
    }

    query = (selector: string): Element | null => document.querySelector(selector);

    queryAll = (selector: string): NodeListOf<Element> => document.querySelectorAll(selector);
}
