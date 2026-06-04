import type { DBManager } from './db';

/**
 * Clone an entry + its content. By default duplicates into the source's own
 * category; passing `targetCategoryId` clones into a different (caller-owned)
 * category — in which case ParentEntryID is reset since the source's parent
 * doesn't exist in the target category.
 *
 * Volatile flags (IsPinned, IsFavorited) are reset on clone.
 *
 * Throws if the source entry is missing, soft-deleted, owned by another user,
 * or the target category is owned by another user. A CROSS-category clone is
 * refused (CATEGORY_LOCKED) when either the source or target category is
 * password-locked: the content is encrypted under the source category's EEK, so
 * copying it verbatim across the encryption boundary would either make the copy
 * undecryptable or drop plaintext into a locked category. (Same-category clones
 * are fine — the EEK is unchanged.) This mirrors move-category's guard.
 */
export class CategoryLockedError extends Error {
    code = 'CATEGORY_LOCKED' as const;
    constructor(msg = 'Cannot duplicate entries into or out of a password-locked category.') {
        super(msg);
        this.name = 'CategoryLockedError';
    }
}

export async function duplicateEntry(
    dbm: DBManager,
    userId: number,
    entryId: number,
    targetCategoryId?: number,
): Promise<number> {
    const tx = dbm.transaction(async () => {
        const src = await dbm.prepare(`
            SELECT e.CategoryID, e.Title, e.PreviewText, e.Icon, e.Tags, e.Mood,
                   e.ParentEntryID, e.EntryType, e.IsLocked, c.PasswordHash AS SourcePasswordHash
            FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ? AND e.IsDeleted = 0
        `).get(entryId, userId) as {
            CategoryID: number; Title: string; PreviewText: string | null;
            Icon: string | null; Tags: string | null; Mood: string | null;
            ParentEntryID: number | null; EntryType: string; IsLocked: number;
            SourcePasswordHash: string | null;
        } | undefined;

        if (!src) throw new Error('Entry not found, soft-deleted, or unauthorized');

        let finalCategoryId = src.CategoryID;
        let finalParentId: number | null = src.ParentEntryID;

        if (targetCategoryId !== undefined && targetCategoryId !== src.CategoryID) {
            const target = await dbm.prepare(
                'SELECT PasswordHash FROM Category WHERE CategoryID = ? AND UserID = ?'
            ).get(targetCategoryId, userId) as { PasswordHash: string | null } | undefined;
            if (!target) throw new Error('Target category not found or unauthorized');
            // Refuse to cross the encryption boundary (see doc above).
            if (src.SourcePasswordHash || target.PasswordHash) throw new CategoryLockedError();
            finalCategoryId = targetCategoryId;
            // Source's parent is in the source category — invalid here. Root it.
            finalParentId = null;
        }

        const insert = await dbm.prepare(`
            INSERT INTO Entry (CategoryID, Title, PreviewText, Icon, Tags, Mood,
                               ParentEntryID, EntryType, IsLocked,
                               IsFavorited, IsPinned, Version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1)
        `).run(
            finalCategoryId,
            `Copy of ${src.Title}`,
            src.PreviewText ?? '',
            src.Icon,
            src.Tags ?? '[]',
            src.Mood,
            finalParentId,
            src.EntryType,
            src.IsLocked,
        );

        const content = await dbm.prepare(
            `SELECT HtmlContent, DocumentJson FROM EntryContent WHERE EntryID = ?`
        ).get(entryId) as { HtmlContent: string | null; DocumentJson: string | null } | undefined;
        await dbm.prepare(
            `INSERT INTO EntryContent (EntryID, HtmlContent, DocumentJson) VALUES (?, ?, ?)`
        ).run(insert.lastInsertRowid, content?.HtmlContent ?? '', content?.DocumentJson ?? null);

        return insert.lastInsertRowid as number;
    });
    return tx();
}
