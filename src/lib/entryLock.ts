import type { DBManager } from './db';

/**
 * Fields that, when present in a PUT /api/entry/[id] body, modify the
 * "content" of the entry — the parts a read-only lock must protect.
 *
 * Metadata fields (mood / favorite / tags / icon / sortOrder / parentEntryId /
 * isExpanded / expectedVersion) are intentionally NOT in this set: David RM
 * lets you tag/categorize a locked entry, and the sidebar's drag-to-reorder
 * shouldn't be blocked either.
 *
 * `isLocked` itself is also excluded so the user can unlock from the menu.
 */
const CONTENT_FIELDS = new Set(['html', 'documentJson', 'title', 'preview']);

export type EntryUpdatePatch = Record<string, unknown>;

/**
 * Returns true when the patch would mutate a locked entry's content. The
 * caller should respond with 423 (Locked) or 403; the existing PUT route
 * picks 403 to match the ownership-check shape.
 *
 * Returns false (i.e. allow) when:
 *   - the entry doesn't exist (the route already 404s),
 *   - the entry is not locked, or
 *   - the patch only touches metadata or the lock toggle.
 */
export async function isWriteToLockedEntryBlocked(
    dbm: DBManager,
    entryId: number,
    patch: EntryUpdatePatch,
): Promise<boolean> {
    const row = await dbm.prepare(
        'SELECT IsLocked FROM Entry WHERE EntryID = ?'
    ).get(entryId) as { IsLocked: number | null } | undefined;
    if (!row) return false;
    if (!row.IsLocked) return false;

    for (const key of Object.keys(patch)) {
        if (patch[key] === undefined) continue;
        if (CONTENT_FIELDS.has(key)) return true;
    }
    return false;
}
