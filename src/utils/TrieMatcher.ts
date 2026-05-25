/**
 * #2: Aho-Corasick-inspired trie for efficient multi-pattern matching.
 * Replaces the large alternation regex in buildLinkerData for O(n) text scanning
 * regardless of the number of rule titles.
 */

interface TrieNode {
    children: Map<string, TrieNode>;
    output: string | null; // The original-case matched title
    fail: TrieNode | null;
}

export class TrieMatcher {
    #root: TrieNode;
    #built = false;

    constructor() {
        this.#root = this.#createNode();
    }

    #createNode(): TrieNode {
        return { children: new Map(), output: null, fail: null };
    }

    /** Add a pattern (case-insensitive matching, preserves original for output) */
    addPattern(pattern: string): void {
        if (pattern.length === 0) return;
        let node = this.#root;
        const lower = pattern.toLowerCase();
        for (const char of lower) {
            if (!node.children.has(char)) {
                node.children.set(char, this.#createNode());
            }
            node = node.children.get(char)!;
        }
        // Longest match wins — only store if longer than existing
        if (!node.output || pattern.length > node.output.length) {
            node.output = pattern;
        }
        this.#built = false;
    }

    /** Build failure links (Aho-Corasick automaton) */
    build(): void {
        if (this.#built) return;
        const queue: TrieNode[] = [];
        // Initialize depth-1 nodes with fail → root
        for (const child of this.#root.children.values()) {
            child.fail = this.#root;
            queue.push(child);
        }
        // BFS to build failure links
        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const [char, child] of current.children) {
                let failNode = current.fail;
                while (failNode && !failNode.children.has(char)) {
                    failNode = failNode.fail;
                }
                child.fail = failNode ? failNode.children.get(char)! : this.#root;
                // Propagate output from fail chain (suffix matches)
                if (!child.output && child.fail.output) {
                    child.output = child.fail.output;
                }
                queue.push(child);
            }
        }
        this.#built = true;
    }

    /** Check if a character is a word boundary (not a letter, digit, or underscore) */
    #isWordBoundary(text: string, index: number): boolean {
        if (index < 0 || index >= text.length) return true;
        const code = text.charCodeAt(index);
        // Basic ASCII word chars: a-z, A-Z, 0-9, _
        if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
            (code >= 97 && code <= 122) || code === 95) return false;
        // Extended: check for Unicode letters (rough heuristic for common ranges)
        if (code > 127) return false; // Treat non-ASCII as non-boundary (conservative)
        return true;
    }

    /**
     * Find all non-overlapping matches in text with word-boundary constraints.
     * Returns matches sorted by position, preferring longest match at each position.
     */
    findMatches(text: string): Array<{ start: number; end: number; pattern: string }> {
        if (!this.#built) this.build();
        const matches: Array<{ start: number; end: number; pattern: string }> = [];
        const lower = text.toLowerCase();
        let node = this.#root;

        // Collect all candidate matches
        const candidates: Array<{ start: number; end: number; pattern: string }> = [];

        for (let i = 0; i < lower.length; i++) {
            const char = lower[i];
            while (node !== this.#root && !node.children.has(char)) {
                node = node.fail!;
            }
            if (node.children.has(char)) {
                node = node.children.get(char)!;
            }

            // Check for matches at this position (walk fail chain)
            let checkNode: TrieNode | null = node;
            while (checkNode && checkNode !== this.#root) {
                if (checkNode.output) {
                    const matchLen = checkNode.output.length;
                    const start = i - matchLen + 1;
                    const end = i + 1;
                    // Word boundary check
                    if (this.#isWordBoundary(text, start - 1) && this.#isWordBoundary(text, end)) {
                        candidates.push({ start, end, pattern: checkNode.output });
                    }
                }
                checkNode = checkNode.fail;
            }
        }

        // Filter to non-overlapping, preferring longest matches and earliest position
        candidates.sort((a, b) => a.start - b.start || b.end - a.end);
        let lastEnd = 0;
        for (const candidate of candidates) {
            if (candidate.start >= lastEnd) {
                matches.push(candidate);
                lastEnd = candidate.end;
            }
        }

        return matches;
    }

    get isEmpty(): boolean {
        return this.#root.children.size === 0;
    }
}
