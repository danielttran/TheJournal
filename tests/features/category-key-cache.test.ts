/**
 * The category key cache holds plaintext EEKs in memory between requests
 * (sliding TTL). It's the only place the unwrapped key lives between an
 * /api/category/[id]/lock POST and the next entry read/write.
 *
 * Tests verify:
 *  - Sliding TTL: a read within the TTL extends the lifetime.
 *  - Expiration: keys evict after CACHE_TTL_MS.
 *  - Cross-user isolation: clearAllForUser only nukes one user's keys.
 *  - Defense-in-depth zeroing on eviction.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    cacheCategoryKey,
    getCategoryKey,
    clearCategoryKey,
    clearAllForUser,
} from '../../src/lib/categoryKeyCache';

const USER_A = 100;
const USER_B = 101;

function fakeEek(): Uint8Array {
    const k = new Uint8Array(32);
    for (let i = 0; i < 32; i++) k[i] = i + 1;  // non-zero so we can detect zeroing
    return k;
}

beforeEach(() => {
    clearAllForUser(USER_A);
    clearAllForUser(USER_B);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('cacheCategoryKey + getCategoryKey', () => {
    it('round-trips a cached EEK', () => {
        const eek = fakeEek();
        cacheCategoryKey(USER_A, 5, eek);
        const out = getCategoryKey(USER_A, 5);
        expect(out).toBeInstanceOf(Uint8Array);
        expect(Buffer.from(out!).equals(Buffer.from(eek))).toBe(true);
    });

    it('returns null for a category that was never cached', () => {
        expect(getCategoryKey(USER_A, 999)).toBeNull();
    });

    it('isolates by user — same categoryId for different users is separate', () => {
        const eek = fakeEek();
        cacheCategoryKey(USER_A, 7, eek);
        expect(getCategoryKey(USER_B, 7)).toBeNull();
    });

    it('clearCategoryKey removes the cache entry', () => {
        cacheCategoryKey(USER_A, 8, fakeEek());
        expect(getCategoryKey(USER_A, 8)).not.toBeNull();
        clearCategoryKey(USER_A, 8);
        expect(getCategoryKey(USER_A, 8)).toBeNull();
    });

    it('clearAllForUser scopes to a single user', () => {
        cacheCategoryKey(USER_A, 1, fakeEek());
        cacheCategoryKey(USER_A, 2, fakeEek());
        cacheCategoryKey(USER_B, 1, fakeEek());
        clearAllForUser(USER_A);
        expect(getCategoryKey(USER_A, 1)).toBeNull();
        expect(getCategoryKey(USER_A, 2)).toBeNull();
        expect(getCategoryKey(USER_B, 1)).not.toBeNull();
    });
});

describe('TTL behaviour', () => {
    it('evicts entries after the TTL elapses', () => {
        vi.useFakeTimers();
        const startMs = 1_700_000_000_000;
        vi.setSystemTime(startMs);
        cacheCategoryKey(USER_A, 11, fakeEek());
        // Within TTL — should be there.
        vi.setSystemTime(startMs + 29 * 60_000);  // 29 min
        expect(getCategoryKey(USER_A, 11)).not.toBeNull();
        // After 30 min TTL with no reads, expire.
        vi.setSystemTime(startMs + 31 * 60_000);
        // Note: getCategoryKey just touched the entry at minute 29 (sliding
        // TTL), so the new expiry is now 29+30=59 min. Skip past that.
        vi.setSystemTime(startMs + 70 * 60_000);
        expect(getCategoryKey(USER_A, 11)).toBeNull();
    });

    it('sliding TTL — reading within the window extends the lifetime', () => {
        vi.useFakeTimers();
        const startMs = 1_700_000_000_000;
        vi.setSystemTime(startMs);
        cacheCategoryKey(USER_A, 12, fakeEek());
        // Read every 20 minutes for 2 hours — entry should stay alive.
        for (let i = 1; i <= 6; i++) {
            vi.setSystemTime(startMs + i * 20 * 60_000);
            expect(getCategoryKey(USER_A, 12), `read at minute ${i*20}`).not.toBeNull();
        }
    });

    it('enforces an absolute lifetime cap even for a continuously-active session', () => {
        vi.useFakeTimers();
        const startMs = 1_700_000_000_000;
        vi.setSystemTime(startMs);
        cacheCategoryKey(USER_A, 13, fakeEek());
        // Read every 20 minutes — the sliding TTL would keep it alive forever,
        // but the 12h hard cap must evict it.
        let lastNonNull = 0;
        for (let min = 20; min <= 13 * 60; min += 20) {
            vi.setSystemTime(startMs + min * 60_000);
            if (getCategoryKey(USER_A, 13) !== null) lastNonNull = min;
        }
        // Stayed alive past ~11h of activity but was force-evicted before 13h.
        expect(lastNonNull).toBeGreaterThanOrEqual(11 * 60);
        expect(lastNonNull).toBeLessThan(13 * 60);
    });

    it('returns a copy, not the live cached buffer (callers cannot mutate the cache)', () => {
        const eek = fakeEek();
        cacheCategoryKey(USER_A, 14, eek);
        const a = getCategoryKey(USER_A, 14)!;
        a.fill(0); // mutating the returned copy must not affect the cache
        const b = getCategoryKey(USER_A, 14)!;
        expect(b[0]).toBe(1);
    });
});

describe('defense-in-depth zeroing', () => {
    it('zeroes the EEK buffer when explicitly cleared', () => {
        const eek = fakeEek();
        const snapshot = new Uint8Array(eek);  // copy to compare
        cacheCategoryKey(USER_A, 21, eek);
        clearCategoryKey(USER_A, 21);
        // The original buffer was passed in by reference and is now zeroed.
        for (let i = 0; i < eek.length; i++) {
            expect(eek[i], `byte ${i} should be zeroed`).toBe(0);
        }
        // Sanity: the snapshot still has the original values.
        expect(snapshot[0]).toBe(1);
    });

    it('zeroes on TTL expiration too', () => {
        vi.useFakeTimers();
        const startMs = 1_700_000_000_000;
        vi.setSystemTime(startMs);
        const eek = fakeEek();
        cacheCategoryKey(USER_A, 22, eek);
        // Step past the TTL window. getCategoryKey is what triggers the
        // expiration check; the eviction path zeroes the buffer.
        vi.setSystemTime(startMs + 60 * 60_000);  // 60 minutes > 30 min TTL
        expect(getCategoryKey(USER_A, 22)).toBeNull();
        for (let i = 0; i < eek.length; i++) {
            expect(eek[i]).toBe(0);
        }
    });
});
