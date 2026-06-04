/**
 * Snippet shortcut auto-expansion matcher (pure — no DOM/editor deps).
 *
 * Given the text immediately before the caret in the current block and the
 * user's snippets, return the snippet whose shortcut the user just finished
 * typing, plus where it starts so the caller can replace that range. A match
 * requires the shortcut to sit at a word boundary (start of block or preceded
 * by whitespace) so "...design" doesn't expand a ";sign" shortcut, and the
 * LONGEST matching shortcut wins so ";s" can't shadow ";sig".
 */
export interface SnippetShortcut {
    shortcut: string | null;
    content: string;
}

export interface SnippetMatch {
    shortcut: string;
    content: string;
    /** Index in textBefore where the matched shortcut begins. */
    start: number;
}

export function matchSnippetShortcut(
    textBefore: string,
    snippets: SnippetShortcut[],
): SnippetMatch | null {
    let best: SnippetMatch | null = null;
    for (const s of snippets) {
        const sc = s.shortcut;
        if (!sc) continue;
        if (!textBefore.endsWith(sc)) continue;
        const start = textBefore.length - sc.length;
        const charBefore = start > 0 ? textBefore[start - 1] : '';
        // Boundary: shortcut must start the block or follow whitespace.
        if (start !== 0 && !/\s/.test(charBefore)) continue;
        if (!best || sc.length > best.shortcut.length) {
            best = { shortcut: sc, content: s.content, start };
        }
    }
    return best;
}
