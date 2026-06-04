import type { DBManager } from './db';

/**
 * Move an entry and its entire subtree into a different category.
 *
 * Every descendant moves with the root (keeping their internal parent links),
 * and only the moved root is re-rooted (ParentEntryID = NULL) since a parent
 * must live in the same category as its children. Done in one transaction so a
 * partial move can't strand descendants in the source category pointing at a
 * cross-category parent — a state the recursive subtree CTEs assume can't exist.
 *
 * Auth / ownership / password-lock checks are the route's responsibility; this
 * helper assumes the move has been authorized.
 */
export async function moveEntrySubtreeToCategory(
    dbm: DBManager,
    entryId: number,
    targetCategoryId: number,
): Promise<number> {
    const tx = dbm.transaction(async () => {
        const rows = await dbm.prepare(`
            WITH RECURSIVE subtree(id) AS (
                SELECT ?
                UNION ALL
                SELECT e.EntryID FROM Entry e JOIN subtree s ON e.ParentEntryID = s.id
            )
            SELECT id FROM subtree
        `).all(entryId) as { id: number }[];
        const ids = rows.map(r => r.id);
        if (ids.length === 0) return 0;
        const placeholders = ids.map(() => '?').join(',');
        await dbm.prepare(
            `UPDATE Entry SET CategoryID = ? WHERE EntryID IN (${placeholders})`
        ).run(targetCategoryId, ...ids);
        await dbm.prepare(
            'UPDATE Entry SET ParentEntryID = NULL WHERE EntryID = ?'
        ).run(entryId);
        return ids.length;
    });
    return tx();
}
