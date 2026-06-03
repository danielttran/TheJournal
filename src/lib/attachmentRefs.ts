/**
 * Attachment-reference remapping for backup import.
 *
 * On restore, every Attachment row is re-inserted and gets a fresh
 * AttachmentID, so the `/api/attachment/{oldId}` URLs embedded in entry HTML /
 * document JSON must be rewritten to the new ids. A naive per-id replace loop
 * collides on shared prefixes — `/api/attachment/1` is a substring of
 * `/api/attachment/15` — silently corrupting every longer id that shares a
 * prefix with an earlier-processed one. This does it in a single pass, matching
 * the full numeric id so there is no collision.
 */
export function remapAttachmentRefs(s: string, attIdMap: Map<number, number>): string {
    return s.replace(/\/api\/attachment\/(\d+)/g, (full, idStr) => {
        const newId = attIdMap.get(Number(idStr));
        return newId ? `/api/attachment/${newId}` : full;
    });
}
