/**
 * DavidRM-style entry references:
 *
 *   "Daily Journal\Trip*" → category "Daily Journal", title-glob "Trip*"
 *   "Title"               → no category constraint, exact-or-glob title
 *   "Notebook\*"          → all entries in category "Notebook"
 *
 * `parseEntryRef` separates the two halves. `matchesGlob` evaluates a
 * title glob against an actual entry title. Both are case-insensitive
 * because DavidRM lookups are not case-sensitive by default.
 */

export interface EntryRef {
    categoryName?: string;
    titlePattern: string;
}

export function parseEntryRef(raw: string): EntryRef | null {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;

    const idx = trimmed.indexOf('\\');
    if (idx < 0) {
        return { titlePattern: trimmed };
    }
    const left = trimmed.substring(0, idx).trim();
    const right = trimmed.substring(idx + 1).trim();
    if (!left || !right) return null;
    return { categoryName: left, titlePattern: right };
}

function globToRegex(glob: string): RegExp {
    // Escape regex metacharacters, then re-expand the two glob wildcards.
    const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expanded = escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
    return new RegExp(`^${expanded}$`, 'i');
}

export function matchesGlob(title: string, pattern: string): boolean {
    if (!pattern) return false;
    try {
        return globToRegex(pattern).test(title);
    } catch {
        return false;
    }
}

/**
 * Build the SQL fragment that resolves a glob pattern to LIKE filters.
 * Used by the lookup route to query SQLite directly instead of pulling
 * every entry into JS. * → %; ? → _; LIKE wildcards in the input are
 * escaped with backslash because we set `ESCAPE '\\'`.
 */
export function globToSqlLike(pattern: string): string {
    return pattern
        .replace(/\\/g, '\\\\')   // backslash → escaped backslash
        .replace(/%/g, '\\%')     // literal % → escaped
        .replace(/_/g, '\\_')     // literal _ → escaped
        .replace(/\*/g, '%')      // glob * → SQL %
        .replace(/\?/g, '_');     // glob ? → SQL _
}
