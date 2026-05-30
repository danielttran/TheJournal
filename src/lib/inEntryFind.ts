/**
 * In-entry find — pure match logic.
 *
 * J8's Ctrl+F finds within the open entry and F3 cycles matches. This app
 * keeps Ctrl+F for the global cross-entry search panel, so in-entry find is a
 * separate find bar. This module owns the match maths so it can be unit-tested
 * without a DOM or a ProseMirror document: the editor extension feeds each text
 * node's string here and maps the returned offsets back to document positions.
 *
 * No React, no DOM — pure functions only.
 */

export interface FindOptions {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
}

export interface TextMatch {
    /** Inclusive start offset into the searched string. */
    start: number;
    /** Exclusive end offset into the searched string. */
    end: number;
}

/** Escape a string so it can be used as a literal inside a RegExp. */
export function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the RegExp used to scan text for a query. Returns null when the query
 * is empty or (in regex mode) syntactically invalid — callers treat null as
 * "no matches" rather than throwing on every keystroke of a half-typed regex.
 */
export function buildSearchRegExp(query: string, opts: FindOptions = {}): RegExp | null {
    if (!query) return null;
    let source = opts.regex ? query : escapeRegExp(query);
    if (opts.wholeWord) source = `\\b(?:${source})\\b`;
    const flags = opts.caseSensitive ? 'g' : 'gi';
    try {
        return new RegExp(source, flags);
    } catch {
        return null;
    }
}

/**
 * Find all non-overlapping matches of `query` in `text`. Zero-width matches
 * (e.g. a regex like `a*` against `bbb`) are skipped and the scan advances so
 * the loop can't spin forever.
 */
export function findMatchesInText(text: string, query: string, opts: FindOptions = {}): TextMatch[] {
    const re = buildSearchRegExp(query, opts);
    if (!re || !text) return [];

    const out: TextMatch[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (m[0].length === 0) {
            // Zero-width match: record nothing useful, just step forward.
            re.lastIndex = start + 1;
            continue;
        }
        out.push({ start, end });
    }
    return out;
}

/**
 * Total match count of `query` across one or more text fragments. Used for the
 * "n of m" readout; positions are computed separately by the extension.
 */
export function countMatches(fragments: string[], query: string, opts: FindOptions = {}): number {
    return fragments.reduce((n, f) => n + findMatchesInText(f, query, opts).length, 0);
}

/**
 * Advance/retreat the active match index with wrap-around. `dir` is +1 (next)
 * or -1 (previous). Returns 0 when there are no matches so the caller has a
 * safe index to clamp against.
 */
export function stepIndex(count: number, current: number, dir: 1 | -1): number {
    if (count <= 0) return 0;
    return ((current + dir) % count + count) % count;
}
