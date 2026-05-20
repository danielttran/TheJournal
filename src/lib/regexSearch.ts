/**
 * Regex-search helpers — used by /api/search when ?regex=1 is passed.
 *
 *  - compileSafeRegex rejects patterns that look catastrophic (nested
 *    quantifiers) or are too long. It does NOT replace `try { new RegExp }`
 *    entirely — anything that compiles passes through to `RegExp`.
 *  - matchEntryAgainstRegex applies the compiled regex to title / content
 *    according to the caller's searchIn scope and returns flags.
 *
 * The route layer does the actual SQL pre-filtering by user/category/date
 * range; this helper only governs the per-row regex test.
 */

export class SafeRegexError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = 'SafeRegexError';
    }
}

const MAX_PATTERN_LENGTH = 1000;

/**
 * Heuristic for catastrophic-backtracking patterns. We reject anything
 * matching one of these classic ReDoS shapes:
 *   - `(...)+` where ... contains another `+`/`*`
 *   - `(...)*` where ... contains another `+`/`*`
 * It is intentionally conservative — false positives are preferable to
 * locking up the server on a hostile query.
 */
function looksReDoS(pattern: string): boolean {
    // Strip escape sequences so we don't false-positive on \+, \*, etc.
    const cleaned = pattern.replace(/\\./g, '');
    // Match an open paren, then anything containing + or *, then a close
    // paren, then + or *.
    return /\([^()]*[+*][^()]*\)[+*]/.test(cleaned);
}

export function compileSafeRegex(
    pattern: string,
    opts: { matchCase: boolean },
): RegExp {
    const p = (pattern ?? '').trim();
    if (!p) throw new SafeRegexError('Empty regex');
    if (p.length > MAX_PATTERN_LENGTH) {
        throw new SafeRegexError(`Regex too long (max ${MAX_PATTERN_LENGTH} chars)`);
    }
    if (looksReDoS(p)) {
        throw new SafeRegexError('Regex looks catastrophic (nested quantifiers)');
    }
    const flags = opts.matchCase ? 'm' : 'mi';
    try {
        return new RegExp(p, flags);
    } catch (err) {
        throw new SafeRegexError(err instanceof Error ? err.message : String(err));
    }
}

export interface MatchInput {
    title: string;
    plainContent: string | null;
    searchIn?: 'title' | 'content' | 'both';
}

export interface MatchResult {
    titleMatch: boolean;
    contentMatch: boolean;
    any: boolean;
}

export function matchEntryAgainstRegex(re: RegExp, input: MatchInput): MatchResult {
    const scope = input.searchIn ?? 'both';
    const tryTitle = scope === 'title' || scope === 'both';
    const tryContent = scope === 'content' || scope === 'both';

    let titleMatch = false;
    let contentMatch = false;

    if (tryTitle && input.title) {
        // Reset lastIndex defensively in case the caller passed a /g regex.
        re.lastIndex = 0;
        titleMatch = re.test(input.title);
    }
    if (tryContent && input.plainContent) {
        re.lastIndex = 0;
        contentMatch = re.test(input.plainContent);
    }

    return { titleMatch, contentMatch, any: titleMatch || contentMatch };
}
