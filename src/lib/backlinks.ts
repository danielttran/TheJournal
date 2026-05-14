import type { DBManager } from './db';
import { extractLinkTargets } from './internalLinks';

export interface Backlink {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
}

/**
 * Find all entries (owned by `userId`) whose HtmlContent references `entryId`
 * via `[[Title]]` or `[[#id]]`.
 *
 * Implementation: pull all candidate entries, parse their HTML for link targets,
 * resolve each target against the title of `entryId` and against `[[#entryId]]`.
 * O(N) over user's entries.
 */
export async function findBacklinks(
    dbm: DBManager,
    userId: number,
    entryId: number
): Promise<Backlink[]> {
    const target = await dbm.prepare(`
        SELECT e.Title FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE e.EntryID = ? AND c.UserID = ?
    `).get(entryId, userId) as { Title: string } | undefined;
    if (!target) return [];

    const titleLower = target.Title.toLowerCase();
    const idMarker = `#${entryId}`;

    const candidates = await dbm.prepare(`
        SELECT e.EntryID, e.Title, e.CategoryID, c.Name AS CategoryName, ec.HtmlContent
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE c.UserID = ?
          AND e.IsDeleted = 0
          AND e.EntryID <> ?
          AND ec.HtmlContent LIKE '%[[%'
    `).all(userId, entryId) as { EntryID: number; Title: string; CategoryID: number; CategoryName: string; HtmlContent: string | null }[];

    const out: Backlink[] = [];
    for (const row of candidates) {
        const targets = extractLinkTargets(row.HtmlContent ?? '');
        const hit = targets.some(t => {
            const trimmed = t.trim();
            if (trimmed === idMarker) return true;
            return trimmed.toLowerCase() === titleLower;
        });
        if (hit) out.push({
            EntryID: row.EntryID,
            Title: row.Title,
            CategoryID: row.CategoryID,
            CategoryName: row.CategoryName,
        });
    }
    return out;
}
