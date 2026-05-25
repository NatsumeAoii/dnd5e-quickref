import { CONFIG } from '../config.js';
import { safeHTML } from '../utils/Utils.js';
import type { StateManager } from '../state/StateManager.js';

/**
 * Extracted from WindowManager — handles cross-reference linkification of rule content.
 * Uses the trie-based matcher (preferred) with regex fallback.
 */
export class PopupLinkifier {
    #stateManager: StateManager;
    #cache = new Map<string, string>();
    #toShortId: (id: string) => string;
    static #CACHE_MAX = 500;

    constructor(stateManager: StateManager, toShortId: (id: string) => string) {
        this.#stateManager = stateManager;
        this.#toShortId = toShortId;

        // Clear cache when ruleset changes
        this.#stateManager.subscribe('settingChanged', (data?: unknown) => {
            const { key } = data as { key: string };
            if (key === 'RULES_2024') this.#cache.clear();
        });
    }

    clearCache(): void {
        this.#cache.clear();
    }

    linkify = (html: string): string => {
        const state = this.#stateManager.getState();
        const trie = state.data.ruleLinkerTrie;
        if (!html || (!trie && !state.data.ruleLinkerRegex)) return html;

        const cached = this.#cache.get(html);
        if (cached) return cached;

        const container = document.createElement('div');
        container.innerHTML = safeHTML(html) as string;

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        const textNodes: Text[] = [];
        let node = walker.nextNode();
        while (node !== null) {
            textNodes.push(node as Text);
            node = walker.nextNode();
        }

        textNodes.forEach((textNode) => {
            const text = textNode.nodeValue || '';
            const matches = trie && !trie.isEmpty
                ? trie.findMatches(text).map((m) => ({ matchText: text.substring(m.start, m.end), index: m.start }))
                : this.#regexFallbackMatches(text, state.data.ruleLinkerRegex);

            if (matches.length === 0) return;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            matches.forEach((match) => {
                const matchText = match.matchText;
                const matchIndex = match.index;

                if (matchIndex > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchIndex)));
                }

                const link = document.createElement('a');
                link.className = 'rule-link';
                link.textContent = matchText;
                const id = state.data.titleLookup.get(matchText.toLowerCase());

                if (id) {
                    link.setAttribute('href', `#${this.#toShortId(id)}`);
                    link.setAttribute(CONFIG.ATTRIBUTES.POPUP_ID, id);
                    fragment.appendChild(link);
                } else {
                    fragment.appendChild(document.createTextNode(matchText));
                }
                lastIndex = matchIndex + matchText.length;
            });

            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            }
            textNode.parentNode!.replaceChild(fragment, textNode);
        });

        const result = container.innerHTML;
        this.#cache.set(html, result);
        if (this.#cache.size > PopupLinkifier.#CACHE_MAX) {
            const firstKey = this.#cache.keys().next().value;
            if (firstKey !== undefined) this.#cache.delete(firstKey);
        }
        return result;
    };

    #regexFallbackMatches(text: string, regex: RegExp | null): Array<{ matchText: string; index: number }> {
        if (!regex) return [];
        regex.lastIndex = 0;
        return Array.from(text.matchAll(regex)).map((m) => ({ matchText: m[0], index: m.index! }));
    }
}
