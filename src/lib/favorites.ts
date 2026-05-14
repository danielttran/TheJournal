import type { DBManager } from './db';

/**
 * Favorites view (David RM parity): list entries the user starred, plus a
 * single-call toggle so a heart button only needs to know the entry ID.
 *
 * Soft-deleted entries are excluded. Listing is ordered most-recently-modified
 * first so the user sees their latest starred work at the top.
 */
export interface FavoriteEntry {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    CreatedDate: string;
    ModifiedDate: string;
    PreviewText: string | null;
}

export interface ListFavoritesOptions {
    categoryId?: number;
    limit?: number;
}

export async function listFavorites(
    dbm: DBManager,
    userId: number,
    opts: ListFavoritesOptions = {}
): Promise<FavoriteEntry[]> {
    const conditions = [
        `c.UserID = ?`,
        `e.IsDeleted = 0`,
        `e.IsFavorited = 1`,
        `e.EntryType = 'Page'`,
    ];
    const params: (string | number)[] = [userId];
    if (typeof opts.categoryId === 'number') {
        conditions.push(`e.CategoryID = ?`);
        params.push(opts.categoryId);
    }
    const limitClause = typeof opts.limit === 'number' && opts.limit > 0
        ? ` LIMIT ${Math.floor(opts.limit)}`
        : '';

    const sql = `
        SELECT e.EntryID, e.Title, e.CategoryID, c.Name AS CategoryName,
               e.CreatedDate, e.ModifiedDate, e.PreviewText
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE ${conditions.join(' AND ')}
        ORDER BY e.ModifiedDate DESC${limitClause}
    `;
    return dbm.prepare(sql).all(...params) as Promise<FavoriteEntry[]>;
}

/**
 * Toggle the favorite flag in a single statement. Returns the new state, or
 * null when the entry does not exist (or belongs to a different user).
 */
export async function toggleFavorite(
    dbm: DBManager,
    userId: number,
    entryId: number
): Promise<boolean | null> {
    // Use the existing user → category → entry join to enforce ownership in
    // the UPDATE itself; a stray entryId from another user is a no-op.
    const updateRes = await dbm.prepare(`
        UPDATE Entry
        SET IsFavorited = CASE WHEN IsFavorited = 1 THEN 0 ELSE 1 END
        WHERE EntryID = ?
          AND CategoryID IN (SELECT CategoryID FROM Category WHERE UserID = ?)
    `).run(entryId, userId);
    if (updateRes.changes === 0) return null;

    const row = await dbm.prepare(
        `SELECT IsFavorited FROM Entry WHERE EntryID = ?`
    ).get(entryId) as { IsFavorited: number } | undefined;
    return row ? row.IsFavorited === 1 : null;
}
