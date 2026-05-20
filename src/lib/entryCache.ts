/**
 * In-memory LRU/TTL cache for entry HTML + Tiptap document JSON, keyed by
 * either `entry-<id>` (when navigated via ?entry=) or
 * `date-<categoryId>-<YYYY-MM-DD>` (when navigated via the calendar).
 *
 * The cache lets the Editor render previously-opened entries instantly on
 * navigation back-and-forth between dates / entries, while still falling
 * through to the server when the cached payload exceeds CACHE_TTL_MS.
 *
 * Pure, no React or DOM. Tested in isolation; the Editor mounts a single
 * module-scoped instance via the exported helpers.
 */
import type { JSONContent } from '@tiptap/react';

export interface CachedEntry {
    html: string;
    documentJson: JSONContent | null;
    timestamp: number;
}

const cache = new Map<string, CachedEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;        // 10 minutes
const CACHE_MAX_ENTRIES = 200;               // hard cap

/**
 * Insert a new payload (or refresh an existing one). After insert, evict
 * the oldest entries until either the size is under the cap OR the oldest
 * remaining entry is still within the TTL window.
 *
 * Iteration order on a Map is insertion order, so the first key we see is
 * the oldest by definition.
 */
export function cacheEntry(
    key: string,
    html: string,
    documentJson: JSONContent | null,
): void {
    cache.delete(key);
    cache.set(key, { html, documentJson, timestamp: Date.now() });

    const now = Date.now();
    for (const [k, v] of cache) {
        if (cache.size <= CACHE_MAX_ENTRIES && now - v.timestamp <= CACHE_TTL_MS) break;
        cache.delete(k);
    }
}

/**
 * Return the cached payload if present and within TTL. Returns null when
 * the key is missing or expired (and removes expired entries opportunistically).
 *
 * Re-inserts the entry on hit so the iteration order tracks recency — a
 * read counts as a touch for LRU purposes.
 */
export function getCachedEntry(key: string): CachedEntry | null {
    const cached = cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    cache.delete(key);
    cache.set(key, { ...cached, timestamp: Date.now() });
    return cached;
}

/** Explicit eviction — used when a save returns 409 and we no longer trust the cached copy. */
export function invalidateEntry(key: string): void {
    cache.delete(key);
}

/** For tests — clear the entire cache. Not exported for general use. */
export function clearAllCachedEntries(): void {
    cache.clear();
}

/** For tests — current size of the cache. */
export function cachedEntryCount(): number {
    return cache.size;
}

export { CACHE_TTL_MS, CACHE_MAX_ENTRIES };
