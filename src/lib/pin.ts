import type { DBManager } from './db';

export interface PinnedRow {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    PinnedDate: string;
}

export async function pinEntry(dbm: DBManager, entryId: number): Promise<void> {
    // Sleep one ms so consecutive pins differ in PinnedDate (SQLite CURRENT_TIMESTAMP has 1-s resolution).
    // We rely on a high-resolution ISO timestamp written directly.
    const ts = new Date().toISOString();
    await dbm.prepare(`UPDATE Entry SET IsPinned = 1, PinnedDate = ? WHERE EntryID = ?`).run(ts, entryId);
}

export async function unpinEntry(dbm: DBManager, entryId: number): Promise<void> {
    await dbm.prepare(`UPDATE Entry SET IsPinned = 0, PinnedDate = NULL WHERE EntryID = ?`).run(entryId);
}

export async function listPinned(dbm: DBManager, userId: number, categoryId?: number): Promise<PinnedRow[]> {
    const params: (string | number)[] = [userId];
    let extra = '';
    if (categoryId !== undefined) {
        extra = ' AND e.CategoryID = ?';
        params.push(categoryId);
    }
    return dbm.prepare(`
        SELECT e.EntryID, e.Title, e.CategoryID, c.Name AS CategoryName, e.PinnedDate
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND e.IsPinned = 1 AND e.IsDeleted = 0${extra}
        ORDER BY e.PinnedDate DESC
    `).all(...params) as Promise<PinnedRow[]>;
}
