import type { DBManager } from './db';

/**
 * David RM "Surprise me" parity: pull one random Page entry the user can
 * revisit. Soft-deleted entries are excluded; locked entries are skipped by
 * default but can be opted into. When `categoryId` is given the pick is
 * scoped to that journal/notebook.
 */
export interface RandomEntry {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CreatedDate: string;
    PreviewText: string | null;
    IsLocked: number;
}

export interface PickRandomOptions {
    categoryId?: number;
    includeLocked?: boolean;
}

export async function pickRandomEntry(
    dbm: DBManager,
    userId: number,
    opts: PickRandomOptions = {}
): Promise<RandomEntry | null> {
    const conditions = [
        `c.UserID = ?`,
        `e.IsDeleted = 0`,
        `e.EntryType = 'Page'`,
    ];
    const params: (string | number)[] = [userId];

    if (typeof opts.categoryId === 'number') {
        conditions.push(`e.CategoryID = ?`);
        params.push(opts.categoryId);
    }
    if (!opts.includeLocked) {
        conditions.push(`e.IsLocked = 0`);
    }

    // ORDER BY RANDOM() then LIMIT 1 — SQLite picks uniformly. With FTS soft-
    // deletes and locked entries already filtered, the picked row is always
    // user-visible.
    const sql = `
        SELECT e.EntryID, e.Title, e.CategoryID, e.CreatedDate, e.PreviewText, e.IsLocked
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE ${conditions.join(' AND ')}
        ORDER BY RANDOM()
        LIMIT 1
    `;

    const rows = (await dbm.prepare(sql).all(...params)) as RandomEntry[];
    return rows[0] ?? null;
}
