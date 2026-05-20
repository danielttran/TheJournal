/**
 * The in-memory entry cache was previously inlined inside Editor.tsx with no
 * tests. Extracted to src/lib/entryCache.ts so it can be exercised directly.
 *
 * Tests cover:
 *  - Basic round-trip and miss.
 *  - LRU promotion on hit (read makes the entry "newest").
 *  - TTL eviction (a stale read returns null and removes the row).
 *  - Cap eviction (oldest insertion evicted when size exceeds the cap).
 *  - invalidateEntry for explicit removal.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    cacheEntry,
    getCachedEntry,
    invalidateEntry,
    clearAllCachedEntries,
    cachedEntryCount,
    CACHE_TTL_MS,
    CACHE_MAX_ENTRIES,
} from '../../src/lib/entryCache';

beforeEach(() => {
    clearAllCachedEntries();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('cacheEntry + getCachedEntry — basics', () => {
    it('round-trips an entry by key', () => {
        cacheEntry('entry-1', '<p>a</p>', { type: 'doc' });
        const cached = getCachedEntry('entry-1');
        expect(cached?.html).toBe('<p>a</p>');
        expect(cached?.documentJson).toEqual({ type: 'doc' });
    });

    it('returns null for a key that was never set', () => {
        expect(getCachedEntry('entry-nope')).toBeNull();
    });

    it('overwrites an existing entry on re-cache', () => {
        cacheEntry('entry-1', '<p>old</p>', null);
        cacheEntry('entry-1', '<p>new</p>', null);
        expect(getCachedEntry('entry-1')?.html).toBe('<p>new</p>');
        expect(cachedEntryCount()).toBe(1);
    });
});

describe('TTL expiration', () => {
    it('returns null and removes the entry once TTL elapses', () => {
        vi.useFakeTimers();
        const start = 1_700_000_000_000;
        vi.setSystemTime(start);
        cacheEntry('entry-1', '<p>a</p>', null);

        // Within TTL — hit.
        vi.setSystemTime(start + CACHE_TTL_MS - 1);
        expect(getCachedEntry('entry-1')).not.toBeNull();

        // Past TTL — miss (and entry is removed).
        vi.setSystemTime(start + 2 * CACHE_TTL_MS);
        expect(getCachedEntry('entry-1')).toBeNull();
        expect(cachedEntryCount()).toBe(0);
    });

    it('sliding TTL — a read within the window resets the timer', () => {
        vi.useFakeTimers();
        const start = 1_700_000_000_000;
        vi.setSystemTime(start);
        cacheEntry('entry-1', '<p>a</p>', null);

        // Read every 5 minutes for an hour — entry should stay alive.
        for (let i = 1; i <= 12; i++) {
            vi.setSystemTime(start + i * 5 * 60_000);
            expect(getCachedEntry('entry-1'), `read at minute ${i*5}`).not.toBeNull();
        }
    });
});

describe('LRU cap eviction', () => {
    it('evicts the oldest insertion once the size exceeds CACHE_MAX_ENTRIES', () => {
        for (let i = 0; i < CACHE_MAX_ENTRIES; i++) {
            cacheEntry(`entry-${i}`, `<p>${i}</p>`, null);
        }
        expect(cachedEntryCount()).toBe(CACHE_MAX_ENTRIES);

        // Inserting one more should evict the oldest (entry-0).
        cacheEntry('entry-fresh', '<p>fresh</p>', null);
        expect(cachedEntryCount()).toBe(CACHE_MAX_ENTRIES);
        expect(getCachedEntry('entry-0')).toBeNull();
        expect(getCachedEntry('entry-fresh')).not.toBeNull();
    });

    it('a recent read promotes the entry so it survives a cap-eviction round', () => {
        for (let i = 0; i < CACHE_MAX_ENTRIES; i++) {
            cacheEntry(`entry-${i}`, `<p>${i}</p>`, null);
        }
        // Touch the oldest — now it should be the newest.
        getCachedEntry('entry-0');

        // Add a fresh entry; the next-oldest (entry-1) should be evicted.
        cacheEntry('entry-fresh', '<p>fresh</p>', null);
        expect(getCachedEntry('entry-0')).not.toBeNull();
        expect(getCachedEntry('entry-1')).toBeNull();
    });
});

describe('invalidateEntry', () => {
    it('removes the entry explicitly', () => {
        cacheEntry('entry-1', '<p>a</p>', null);
        invalidateEntry('entry-1');
        expect(getCachedEntry('entry-1')).toBeNull();
        expect(cachedEntryCount()).toBe(0);
    });

    it('is a no-op on a missing key', () => {
        invalidateEntry('entry-nope');  // should not throw
        expect(cachedEntryCount()).toBe(0);
    });
});
