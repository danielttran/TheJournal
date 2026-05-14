import type { DBManager } from './db';

/** Normalize a single user-entered tag: lowercase, trim, drop trailing commas. */
export function normalizeTag(raw: string): string {
    return raw.trim().replace(/,+$/, '').toLowerCase();
}

/**
 * Autocomplete suggestions for the editor's tag input — pure prefix filter
 * over `listDistinctTags`, ranked by usage count (desc) then alpha.
 * Matching is case-insensitive against the normalized tag.
 */
export async function suggestTags(
    dbm: DBManager,
    userId: number,
    prefix: string,
    limit = 10
): Promise<{ tag: string; count: number }[]> {
    if (limit <= 0) return [];
    const needle = normalizeTag(prefix);
    const all = await listDistinctTags(dbm, userId);
    if (!needle) return all.slice(0, limit);
    return all
        .filter(t => t.tag.startsWith(needle))
        .slice(0, limit);
}

/** Aggregate all tags across the user's entries, sorted by count desc. */
export async function listDistinctTags(
    dbm: DBManager,
    userId: number
): Promise<{ tag: string; count: number }[]> {
    const rows = await dbm.prepare(`
        SELECT e.Tags FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND e.Tags IS NOT NULL AND e.Tags <> '[]' AND e.Tags <> ''
    `).all(userId) as { Tags: string }[];

    const counts = new Map<string, number>();
    for (const row of rows) {
        let parsed: unknown;
        try { parsed = JSON.parse(row.Tags); } catch { continue; }
        if (!Array.isArray(parsed)) continue;
        for (const t of parsed) {
            if (typeof t !== 'string') continue;
            const key = normalizeTag(t);
            if (!key) continue;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }

    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export type TagFilterMode = 'all' | 'any';

/**
 * Return entry IDs filtered by tag membership.
 *   - mode='all' (default): entry must contain EVERY requested tag (AND)
 *   - mode='any': entry must contain AT LEAST ONE requested tag (OR)
 * Case-insensitive matching via `normalizeTag`.
 */
export async function filterEntriesByTags(
    dbm: DBManager,
    userId: number,
    tags: string[],
    categoryId?: number,
    mode: TagFilterMode = 'all',
): Promise<number[]> {
    const wanted = tags.map(normalizeTag).filter(Boolean);
    if (wanted.length === 0) return [];

    const params: (string | number)[] = [userId];
    let query = `
        SELECT e.EntryID, e.Tags FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND e.Tags IS NOT NULL AND e.Tags <> '[]' AND e.Tags <> ''
    `;
    if (categoryId !== undefined) {
        query += ' AND e.CategoryID = ?';
        params.push(categoryId);
    }
    const rows = await dbm.prepare(query).all(...params) as { EntryID: number; Tags: string }[];

    const matched: number[] = [];
    for (const row of rows) {
        let parsed: unknown;
        try { parsed = JSON.parse(row.Tags); } catch { continue; }
        if (!Array.isArray(parsed)) continue;
        const norm = new Set(parsed.filter((t): t is string => typeof t === 'string').map(normalizeTag));
        const hit = mode === 'any'
            ? wanted.some(w => norm.has(w))
            : wanted.every(w => norm.has(w));
        if (hit) matched.push(row.EntryID);
    }
    return matched;
}
