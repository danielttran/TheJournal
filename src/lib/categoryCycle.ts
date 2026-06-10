/**
 * Category (tab) cycling — J8's Ctrl+Tab. Pure so the wrap-around math is
 * testable; TabBar feeds it the ordered tab id list and navigates the result.
 */
export function adjacentCategoryId(
    orderedIds: number[],
    activeId: number | null,
    direction: 1 | -1,
): number | null {
    if (orderedIds.length === 0) return null;
    const idx = activeId === null ? -1 : orderedIds.indexOf(activeId);
    if (idx === -1) return orderedIds[0]; // no active tab (e.g. dashboard) → first
    if (orderedIds.length === 1) return null; // nowhere to go
    const next = (idx + direction + orderedIds.length) % orderedIds.length;
    return orderedIds[next];
}
