import type { DBManager } from './db';
import { normalizeTag } from './tags';

export interface BulkResult { changed: number; }

// SQLite's SQLITE_MAX_VARIABLE_NUMBER is 32766 since 3.32; we chunk well below
// that so `IN (?, ?, …)` queries never trip the host-parameter ceiling no
// matter how many entry IDs the caller submits.
const SQL_IN_CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
    if (arr.length <= size) return [arr];
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/** Return the subset of `entryIds` that the user owns. */
async function ownedIds(dbm: DBManager, userId: number, entryIds: number[]): Promise<number[]> {
    if (entryIds.length === 0) return [];
    const owned: number[] = [];
    for (const part of chunk(entryIds, SQL_IN_CHUNK)) {
        const placeholders = part.map(() => '?').join(',');
        const rows = await dbm.prepare(`
            SELECT e.EntryID FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE c.UserID = ? AND e.EntryID IN (${placeholders})
        `).all(userId, ...part) as { EntryID: number }[];
        for (const r of rows) owned.push(r.EntryID);
    }
    return owned;
}

async function expandSubtree(dbm: DBManager, rootIds: number[]): Promise<number[]> {
    if (rootIds.length === 0) return [];
    const ids: number[] = [];
    for (const part of chunk(rootIds, SQL_IN_CHUNK)) {
        const placeholders = part.map(() => '?').join(',');
        const rows = await dbm.prepare(`
            WITH RECURSIVE st(id) AS (
                SELECT EntryID FROM Entry WHERE EntryID IN (${placeholders})
                UNION ALL
                SELECT e.EntryID FROM Entry e JOIN st ON e.ParentEntryID = st.id
            )
            SELECT id FROM st
        `).all(...part) as { id: number }[];
        for (const r of rows) ids.push(r.id);
    }
    return ids;
}

export async function bulkSoftDelete(dbm: DBManager, userId: number, entryIds: number[]): Promise<BulkResult> {
    const tx = dbm.transaction(async () => {
        const owned = await ownedIds(dbm, userId, entryIds);
        if (owned.length === 0) return { changed: 0 };
        const ids = await expandSubtree(dbm, owned);
        let changed = 0;
        for (const part of chunk(ids, SQL_IN_CHUNK)) {
            const ph = part.map(() => '?').join(',');
            const r = await dbm.prepare(
                `UPDATE Entry SET IsDeleted = 1, DeletedDate = CURRENT_TIMESTAMP WHERE EntryID IN (${ph})`
            ).run(...part);
            changed += r.changes;
        }
        return { changed };
    });
    return tx();
}

export async function bulkRestore(dbm: DBManager, userId: number, entryIds: number[]): Promise<BulkResult> {
    const tx = dbm.transaction(async () => {
        const owned = await ownedIds(dbm, userId, entryIds);
        if (owned.length === 0) return { changed: 0 };
        const ids = await expandSubtree(dbm, owned);
        let changed = 0;
        for (const part of chunk(ids, SQL_IN_CHUNK)) {
            const ph = part.map(() => '?').join(',');
            const r = await dbm.prepare(
                `UPDATE Entry SET IsDeleted = 0, DeletedDate = NULL WHERE EntryID IN (${ph})`
            ).run(...part);
            changed += r.changes;
        }
        return { changed };
    });
    return tx();
}

export async function bulkPermanentDelete(dbm: DBManager, userId: number, entryIds: number[]): Promise<BulkResult> {
    const tx = dbm.transaction(async () => {
        const owned = await ownedIds(dbm, userId, entryIds);
        if (owned.length === 0) return { changed: 0 };
        const ids = await expandSubtree(dbm, owned);
        let changed = 0;
        for (const part of chunk(ids, SQL_IN_CHUNK)) {
            const ph = part.map(() => '?').join(',');
            await dbm.prepare(`DELETE FROM EntryContent WHERE EntryID IN (${ph})`).run(...part);
            const r = await dbm.prepare(`DELETE FROM Entry WHERE EntryID IN (${ph})`).run(...part);
            changed += r.changes;
        }
        return { changed };
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

        const rows: { EntryID: number; Tags: string | null }[] = [];
        for (const part of chunk(owned, SQL_IN_CHUNK)) {
            const placeholders = part.map(() => '?').join(',');
            const batch = await dbm.prepare(
                `SELECT EntryID, Tags FROM Entry WHERE EntryID IN (${placeholders})`
            ).all(...part) as { EntryID: number; Tags: string | null }[];
            for (const r of batch) rows.push(r);
        }

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
