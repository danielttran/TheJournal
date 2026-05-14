import type { DBManager } from './db';

export interface AnniversaryEntry {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    CreatedDate: string;
    PreviewText: string | null;
    Icon: string | null;
}

/**
 * Return all entries from prior years that fall on the same MM-DD as `today`.
 * Excludes entries from `today.getFullYear()` so the user sees only memories.
 * Excludes soft-deleted entries. Ordered oldest year first.
 */
export async function onThisDay(
    dbm: DBManager,
    userId: number,
    today: Date
): Promise<AnniversaryEntry[]> {
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const yyyy = String(today.getFullYear());

    return dbm.prepare(`
        SELECT e.EntryID, e.Title, e.CategoryID, c.Name AS CategoryName,
               e.CreatedDate, e.PreviewText, e.Icon
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ?
          AND e.IsDeleted = 0
          AND e.EntryType = 'Page'
          AND strftime('%m', e.CreatedDate) = ?
          AND strftime('%d', e.CreatedDate) = ?
          AND strftime('%Y', e.CreatedDate) <> ?
        ORDER BY e.CreatedDate ASC
    `).all(userId, mm, dd, yyyy) as Promise<AnniversaryEntry[]>;
}
