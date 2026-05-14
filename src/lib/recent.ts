import type { DBManager } from './db';

export interface RecentEntry {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    LastAccessedDate: string;
    Icon: string | null;
}

/** Bump LastAccessedDate on an entry the user owns. No-op otherwise. */
export async function touchEntry(dbm: DBManager, userId: number, entryId: number): Promise<void> {
    await dbm.prepare(`
        UPDATE Entry SET LastAccessedDate = CURRENT_TIMESTAMP
        WHERE EntryID = ?
          AND CategoryID IN (SELECT CategoryID FROM Category WHERE UserID = ?)
    `).run(entryId, userId);
}

/** Top-N entries by LastAccessedDate desc, excluding never-accessed + deleted. */
export async function listRecent(dbm: DBManager, userId: number, limit: number): Promise<RecentEntry[]> {
    return dbm.prepare(`
        SELECT e.EntryID, e.Title, e.CategoryID, c.Name AS CategoryName,
               e.LastAccessedDate, e.Icon
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ?
          AND e.IsDeleted = 0
          AND e.LastAccessedDate IS NOT NULL
        ORDER BY e.LastAccessedDate DESC
        LIMIT ?
    `).all(userId, limit) as Promise<RecentEntry[]>;
}
