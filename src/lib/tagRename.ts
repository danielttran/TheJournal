import type { DBManager } from './db';
import { normalizeTag } from './tags';

export interface RenameResult { affectedCount: number; }

async function rewriteUserTags(
    dbm: DBManager,
    userId: number,
    transform: (tags: string[]) => string[] | null,
): Promise<RenameResult> {
    const tx = dbm.transaction(async () => {
        const rows = await dbm.prepare(`
            SELECT e.EntryID, e.Tags FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE c.UserID = ? AND e.Tags IS NOT NULL AND e.Tags <> '[]'
        `).all(userId) as { EntryID: number; Tags: string }[];

        let affected = 0;
        for (const row of rows) {
            let parsed: unknown;
            try { parsed = JSON.parse(row.Tags); } catch { continue; }
            if (!Array.isArray(parsed)) continue;
            const before = parsed.filter((t): t is string => typeof t === 'string');
            const after = transform(before);
            if (after === null) continue;
            // Dedup + normalize
            const norm = [...new Set(after.map(normalizeTag).filter(Boolean))];
            if (JSON.stringify(norm) === JSON.stringify(before.map(normalizeTag))) continue;
            await dbm.prepare(
                `UPDATE Entry SET Tags = ?, ModifiedDate = CURRENT_TIMESTAMP WHERE EntryID = ?`
            ).run(JSON.stringify(norm), row.EntryID);
            affected += 1;
        }
        return { affectedCount: affected };
    });
    return tx();
}

/**
 * Rename `oldTag` → `newTag` in every entry the user owns.
 * If an entry already has both, `newTag` survives once (no duplication).
 */
export async function renameTag(
    dbm: DBManager,
    userId: number,
    oldTag: string,
    newTag: string,
): Promise<RenameResult> {
    const fromNorm = normalizeTag(oldTag);
    const toNorm = normalizeTag(newTag);
    if (!fromNorm || !toNorm) return { affectedCount: 0 };
    if (fromNorm === toNorm) return { affectedCount: 0 };

    return rewriteUserTags(dbm, userId, (tags) => {
        const hasOld = tags.some(t => normalizeTag(t) === fromNorm);
        if (!hasOld) return null;
        return tags.flatMap(t => normalizeTag(t) === fromNorm ? [toNorm] : [t]);
    });
}

/**
 * Merge `sourceTag` into `destTag`: remove source from every entry; add dest
 * if not already present. Same as renameTag in effect but explicit.
 */
export async function mergeTag(
    dbm: DBManager,
    userId: number,
    sourceTag: string,
    destTag: string,
): Promise<RenameResult> {
    return renameTag(dbm, userId, sourceTag, destTag);
}
