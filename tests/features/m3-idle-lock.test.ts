/**
 * M3 — Security UX:
 *   shouldLockForIdle(thresholdMinutes, lastActivityMs, nowMs) — pure
 *   helper used by the renderer's idle-watcher and the Electron main
 *   process to decide whether to send the lock signal.
 *
 *   Tests live in pure-function territory because the surrounding UI is
 *   driven by browser events that vitest can't easily simulate.
 */
import { describe, it, expect } from 'vitest';
import { shouldLockForIdle } from '../../src/lib/idleLock';

describe('shouldLockForIdle', () => {
    it('returns false when the threshold is zero (feature disabled)', () => {
        expect(shouldLockForIdle(0, 0, 1_000_000_000_000)).toBe(false);
        expect(shouldLockForIdle(0, Date.now(), Date.now() + 60 * 60_000)).toBe(false);
    });

    it('returns false when the threshold is negative (defensive)', () => {
        expect(shouldLockForIdle(-5, 0, 1_000_000_000_000)).toBe(false);
    });

    it('returns false when the user has been active within the threshold', () => {
        const now = 1_000_000_000_000;
        expect(shouldLockForIdle(5, now - 2 * 60_000, now)).toBe(false); // 2 min idle, 5 min threshold
        expect(shouldLockForIdle(5, now - 4 * 60_000 - 59_000, now)).toBe(false); // just under 5 min
    });

    it('returns true when the user has been idle past the threshold', () => {
        const now = 1_000_000_000_000;
        expect(shouldLockForIdle(5, now - 5 * 60_000, now)).toBe(true);
        expect(shouldLockForIdle(5, now - 6 * 60_000, now)).toBe(true);
        expect(shouldLockForIdle(15, now - 30 * 60_000, now)).toBe(true);
    });

    it('treats a future lastActivityMs as fresh activity (clock skew)', () => {
        // If the renderer's clock briefly ticks behind the lastActivity stamp
        // (e.g. system clock adjusted), we should not lock.
        const now = 1_000_000_000_000;
        expect(shouldLockForIdle(5, now + 10_000, now)).toBe(false);
    });

    it('treats a non-finite threshold as disabled', () => {
        const now = Date.now();
        expect(shouldLockForIdle(Number.NaN, 0, now)).toBe(false);
        expect(shouldLockForIdle(Number.POSITIVE_INFINITY, 0, now)).toBe(false);
    });
});
