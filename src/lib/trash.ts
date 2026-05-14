import type { DBManager } from './db';

/**
 * Collect the entry id + all descendant ids using a recursive CTE.
 * Used by both soft-delete and restore so a single tree operation
 * affects the whole subtree consistently.
 */
async function subtreeIds(dbm: DBManager, rootId: number): Promise<number[]> {
    const rows = await dbm.prepare(`
        WITH RECURSIVE subtree(id) AS (
            SELECT ?
            UNION ALL
            SELECT e.EntryID FROM Entry e JOIN subtree s ON e.ParentEntryID = s.id
        )
        SELECT id FROM subtree
    `).all(rootId) as { id: number }[];
    return rows.map(r => r.id);
}

/** Mark an entry and all its descendants as soft-deleted. */
export async function softDeleteEntry(dbm: DBManager, entryId: number): Promise<void> {
    const tx = dbm.transaction(async () => {
        const ids = await subtreeIds(dbm, entryId);
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        await dbm.prepare(
            `UPDATE Entry SET IsDeleted = 1, DeletedDate = CURRENT_TIMESTAMP WHERE EntryID IN (${placeholders})`
        ).run(...ids);
    });
    await tx();
}

/** Restore an entry and all its descendants. */
export async function restoreEntry(dbm: DBManager, entryId: number): Promise<void> {
    const tx = dbm.transaction(async () => {
        const ids = await subtreeIds(dbm, entryId);
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        await dbm.prepare(
            `UPDATE Entry SET IsDeleted = 0, DeletedDate = NULL WHERE EntryID IN (${placeholders})`
        ).run(...ids);
    });
    await tx();
}

/** Permanently remove an entry + descendants + content. */
export async function permanentlyDeleteEntry(dbm: DBManager, entryId: number): Promise<void> {
    const tx = dbm.transaction(async () => {
        const ids = await subtreeIds(dbm, entryId);
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        await dbm.prepare(`DELETE FROM EntryContent WHERE EntryID IN (${placeholders})`).run(...ids);
        await dbm.prepare(`DELETE FROM Entry WHERE EntryID IN (${placeholders})`).run(...ids);
    });
    await tx();
}

export interface TrashRow {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    DeletedDate: string;
}

/**
 * List top-level deleted entries belonging to user.
 * "Top-level" = entry is deleted AND either has no parent, or its parent is NOT deleted
 * (so we don't list every node inside an already-deleted subtree).
 */
export async function listTrash(dbm: DBManager, userId: number, limit: number = 500): Promise<TrashRow[]> {
    return dbm.prepare(`
        SELECT e.EntryID, e.Title, e.CategoryID, c.Name AS CategoryName, e.DeletedDate
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN Entry p ON e.ParentEntryID = p.EntryID
        WHERE c.UserID = ?
          AND e.IsDeleted = 1
          AND (e.ParentEntryID IS NULL OR p.IsDeleted = 0)
        ORDER BY e.DeletedDate DESC
        LIMIT ?
    `).all(userId, limit) as Promise<TrashRow[]>;
}

/**
 * Hard-delete entries soft-deleted more than `daysOld` days ago.
 * If `userId` is provided, restricts to that user's entries — REQUIRED for
 * any caller exposed to user input. Returns count purged.
 */
export async function purgeOldDeletedEntries(
    dbm: DBManager,
    daysOld: number,
    userId?: number
): Promise<number> {
    const tx = dbm.transaction(async () => {
        const params: (string | number)[] = [`-${daysOld} days`];
        let query = `
            SELECT e.EntryID FROM Entry e
            WHERE e.IsDeleted = 1 AND e.DeletedDate IS NOT NULL
              AND e.DeletedDate < datetime('now', ?)
        `;
        if (userId !== undefined) {
            query += ' AND e.CategoryID IN (SELECT CategoryID FROM Category WHERE UserID = ?)';
            params.push(userId);
        }
        const rows = await dbm.prepare(query).all(...params) as { EntryID: number }[];
        if (rows.length === 0) return 0;
        const ids = rows.map(r => r.EntryID);
        const placeholders = ids.map(() => '?').join(',');
        await dbm.prepare(`DELETE FROM EntryContent WHERE EntryID IN (${placeholders})`).run(...ids);
        const result = await dbm.prepare(`DELETE FROM Entry WHERE EntryID IN (${placeholders})`).run(...ids);
        return result.changes;
    });
    return tx();
}
