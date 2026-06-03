/**
 * Server-side cache for unlocked category Entry Encryption Keys (EEKs).
 *
 * The user POSTs their password to /api/category/[id]/unlock; the route
 * verifies and stashes the EEK here. Subsequent reads of entries inside
 * that category decrypt with the cached EEK.
 *
 * Lives in module scope (one instance per Node process). Entries auto-
 * expire after CACHE_TTL_MS so an idle session doesn't keep plaintext
 * keys in memory indefinitely.
 */

const CACHE_TTL_MS = 30 * 60_000; // 30 minutes (sliding, per-read)
// Absolute cap so the sliding TTL can't keep a plaintext key resident forever
// for a session that merely polls. Even a continuously-active session must
// re-unlock after this long.
const MAX_LIFETIME_MS = 12 * 60 * 60_000; // 12 hours

interface Entry {
    eek: Uint8Array;
    expiresAt: number;
    // Hard expiry: never extended, regardless of reads.
    hardExpiresAt: number;
}

const cache = new Map<string, Entry>();

function key(userId: number, categoryId: number): string {
    return `${userId}:${categoryId}`;
}

export function cacheCategoryKey(userId: number, categoryId: number, eek: Uint8Array): void {
    const now = Date.now();
    cache.set(key(userId, categoryId), {
        eek,
        expiresAt: now + CACHE_TTL_MS,
        hardExpiresAt: now + MAX_LIFETIME_MS,
    });
}

// Defense in depth: on eviction we zero the EEK buffer before dropping the
// reference. JS GC will eventually reclaim the memory, but until then a
// heap dump of the running process would expose the plaintext key. This
// shrinks (not closes) that window. The crypto.randomBytes-allocated
// Uint8Array we cache is backed by a regular ArrayBuffer we own, so
// in-place fill is safe.
function evict(k: string): void {
    const entry = cache.get(k);
    if (!entry) return;
    try { entry.eek.fill(0); } catch { /* immutable view — best effort */ }
    cache.delete(k);
}

export function getCategoryKey(userId: number, categoryId: number): Uint8Array | null {
    const k = key(userId, categoryId);
    const entry = cache.get(k);
    if (!entry) return null;
    const now = Date.now();
    if (now > entry.expiresAt || now > entry.hardExpiresAt) {
        evict(k);
        return null;
    }
    // Touch — sliding TTL keeps active sessions unlocked, but never past the
    // absolute hard cap.
    entry.expiresAt = Math.min(now + CACHE_TTL_MS, entry.hardExpiresAt);
    // Return a COPY, not the live buffer: callers must not share a reference
    // with the cache, or a concurrent evict()/TTL expiry could zero the key
    // out from under an in-flight encrypt/decrypt (e.g. mid transform loop).
    return new Uint8Array(entry.eek);
}

export function clearCategoryKey(userId: number, categoryId: number): void {
    evict(key(userId, categoryId));
}

export function clearAllForUser(userId: number): void {
    const prefix = `${userId}:`;
    for (const k of [...cache.keys()]) {
        if (k.startsWith(prefix)) evict(k);
    }
}
