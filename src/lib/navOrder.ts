/**
 * Pure helper for "Previous / Next entry" navigation (David RM Go menu).
 *
 * Given the ordered list of entry ids exactly as the sidebar shows them and
 * the currently-open id, return the neighbour in the requested direction.
 * No wrap-around: returns null at either end so callers can no-op.
 */
export function adjacentEntryId(
    orderedIds: number[],
    currentId: number | null,
    dir: 'prev' | 'next',
): number | null {
    if (orderedIds.length === 0) return null;

    // No current selection: next → first, prev → last.
    if (currentId == null) {
        return dir === 'next' ? orderedIds[0] : orderedIds[orderedIds.length - 1];
    }

    const idx = orderedIds.indexOf(currentId);
    // Current id not in the visible list (e.g. a sub-entry): start from an edge.
    if (idx === -1) {
        return dir === 'next' ? orderedIds[0] : orderedIds[orderedIds.length - 1];
    }

    const target = dir === 'next' ? idx + 1 : idx - 1;
    if (target < 0 || target >= orderedIds.length) return null;
    return orderedIds[target];
}
