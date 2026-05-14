import type { DBManager } from './db';
import { normalizeTag } from './tags';

export interface BulkResult { changed: number; }

/** Return the subset of `entryIds` that the user owns. */
async function ownedIds(dbm: DBManager, userId: number, entryIds: number[]): Promise<number[]> {
    if (entryIds.length === 0) return [];
    const placeholders = entryIds.map(() => '?').join(',');
    const rows = await dbm.prepare(`
        SELECT e.EntryID FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND e.EntryID IN (${placeholders})
    `).all(userId, ...entryIds) as { EntryID: number }[];
    return rows.map(r => r.EntryID);
}

export async function bulkSoftDelete(dbm: DBManager, userId: number, entryIds: number[]): Promise<BulkResult> {
    const tx = dbm.transaction(async () => {
        const owned = await ownedIds(dbm, userId, entryIds);
        if (owned.length === 0) return { changed: 0 };
        // Apply to the owned roots + all descendants
        const placeholders = owned.map(() => '?').join(',');
        const subtree = await dbm.prepare(`
            WITH RECURSIVE st(id) AS (
                SELECT EntryID FROM Entry WHERE EntryID IN (${placeholders})
                UNION ALL
                SELECT e.EntryID FROM Entry e JOIN st ON e.ParentEntryID = st.id
            )
            SELECT id FROM st
        `).all(...owned) as { id: number }[];
        const ids = subtree.map(r => r.id);
        const ph = ids.map(() => '?').join(',');
        const r = await dbm.prepare(
            `UPDATE Entry SET IsDeleted = 1, DeletedDate = CURRENT_TIMESTAMP WHERE EntryID IN (${ph})`
        ).run(...ids);
        return { changed: r.changes };
    });
    return tx();
}

export async function bulkRestore(dbm: DBManager, userId: number, entryIds: number[]): Promise<BulkResult> {
    const tx = dbm.transaction(async () => {
        const owned = await ownedIds(dbm, userId, entryIds);
        if (owned.length === 0) return { changed: 0 };
        const placeholders = owned.map(() => '?').join(',');
        const subtree = await dbm.prepare(`
            WITH RECURSIVE st(id) AS (
                SELECT EntryID FROM Entry WHERE EntryID IN (${placeholders})
                UNION ALL
                SELECT e.EntryID FROM Entry e JOIN st ON e.ParentEntryID = st.id
            )
            SELECT id FROM st
        `).all(...owned) as { id: number }[];
        const ids = subtree.map(r => r.id);
        const ph = ids.map(() => '?').join(',');
        const r = await dbm.prepare(
            `UPDATE Entry SET IsDeleted = 0, DeletedDate = NULL WHERE EntryID IN (${ph})`
        ).run(...ids);
        return { changed: r.changes };
    });
    return tx();
}

export async function bulkPermanentDelete(dbm: DBManager, userId: number, entryIds: number[]): Promise<BulkResult> {
    const tx = dbm.transaction(async () => {
        const owned = await ownedIds(dbm, userId, entryIds);
        if (owned.length === 0) return { changed: 0 };
        const placeholders = owned.map(() => '?').join(',');
        const subtree = await dbm.prepare(`
            WITH RECURSIVE st(id) AS (
                SELECT EntryID FROM Entry WHERE EntryID IN (${placeholders})
                UNION ALL
                SELECT e.EntryID FROM Entry e JOIN st ON e.ParentEntryID = st.id
            )
            SELECT id FROM st
        `).all(...owned) as { id: number }[];
        const ids = subtree.map(r => r.id);
        const ph = ids.map(() => '?').join(',');
        await dbm.prepare(`DELETE FROM EntryContent WHERE EntryID IN (${ph})`).run(...ids);
        const r = await dbm.prepare(`DELETE FROM Entry WHERE EntryID IN (${ph})`).run(...ids);
        return { changed: r.changes };
    });
    return tx();
}

async function rewriteTags(
    dbm: DBManager,
    userId: number,
    entryIds: number[],
    mutate: (tags: string[]) => string[]
): Promise<BulkResult> {
    const tx = dbm.transaction(async () => {
        const owned = await ownedIds(dbm, userId, entryIds);
        if (owned.length === 0) return { changed: 0 };
        const placeholders = owned.map(() => '?').join(',');
        const rows = await dbm.prepare(
            `SELECT EntryID, Tags FROM Entry WHERE EntryID IN (${placeholders})`
        ).all(...owned) as { EntryID: number; Tags: string | null }[];

        // Prepare statement once and reuse — avoids per-row parse overhead on bulk ops.
        const updateStmt = dbm.prepare(
            `UPDATE Entry SET Tags = ?, ModifiedDate = CURRENT_TIMESTAMP WHERE EntryID = ?`
        );
        let changed = 0;
        for (const row of rows) {
            let parsed: unknown;
            try { parsed = row.Tags ? JSON.parse(row.Tags) : []; } catch { parsed = []; }
            const before = Array.isArray(parsed)
                ? parsed.filter((t): t is string => typeof t === 'string')
                : [];
            const after = mutate(before);
            const beforeJson = JSON.stringify(before);
            const afterJson = JSON.stringify(after);
            if (beforeJson !== afterJson) {
                await updateStmt.run(afterJson, row.EntryID);
                changed += 1;
            }
        }
        return { changed };
    });
    return tx();
}

export async function bulkAddTag(dbm: DBManager, userId: number, entryIds: number[], tag: string): Promise<BulkResult> {
    const norm = normalizeTag(tag);
    if (!norm) return { changed: 0 };
    return rewriteTags(dbm, userId, entryIds, (tags) => {
        if (tags.map(normalizeTag).includes(norm)) return tags;
        return [...tags, norm];
    });
}

export async function bulkRemoveTag(dbm: DBManager, userId: number, entryIds: number[], tag: string): Promise<BulkResult> {
    const norm = normalizeTag(tag);
    if (!norm) return { changed: 0 };
    return rewriteTags(dbm, userId, entryIds, (tags) =>
        tags.filter(t => normalizeTag(t) !== norm)
    );
}
