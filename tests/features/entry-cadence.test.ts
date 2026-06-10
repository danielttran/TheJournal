import { describe, it, expect } from 'vitest';
import { computeMissedDays } from '../../src/lib/entryCadence';

// One grid week, Mon 2026-06-01 .. Sun 2026-06-07.
const WEEK = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07'];
const ALL_IN = WEEK.map(() => true);

describe('computeMissedDays (Entry Frequency calendar highlighting)', () => {
    it('daily: marks past in-month days without entries, never today/future', () => {
        const hasEntry = [true, false, false, true, false, false, false];
        const missed = computeMissedDays({
            days: WEEK, inCurrentMonth: ALL_IN, hasEntry,
            todayYmd: '2026-06-05', frequency: 'daily',
        });
        // 1st has entry; 2nd+3rd missed; 4th has entry; 5th is today; 6th/7th future.
        expect(missed).toEqual([false, true, true, false, false, false, false]);
    });

    it('daily: out-of-month cells are never marked', () => {
        const missed = computeMissedDays({
            days: WEEK,
            inCurrentMonth: [false, true, true, true, true, true, true],
            hasEntry: WEEK.map(() => false),
            todayYmd: '2026-06-08', frequency: 'daily',
        });
        expect(missed[0]).toBe(false);
        expect(missed.slice(1).every(Boolean)).toBe(true);
    });

    it('hourly behaves like daily on a month grid', () => {
        const missed = computeMissedDays({
            days: WEEK, inCurrentMonth: ALL_IN, hasEntry: WEEK.map(() => false),
            todayYmd: '2026-06-03', frequency: 'hourly',
        });
        expect(missed).toEqual([true, true, false, false, false, false, false]);
    });

    it('weekly: a fully-elapsed empty week marks only its last in-month day', () => {
        const missed = computeMissedDays({
            days: WEEK, inCurrentMonth: ALL_IN, hasEntry: WEEK.map(() => false),
            todayYmd: '2026-06-08', frequency: 'weekly',
        });
        expect(missed).toEqual([false, false, false, false, false, false, true]);
    });

    it('weekly: a week with any entry, or still in progress, is not missed', () => {
        const withEntry = computeMissedDays({
            days: WEEK, inCurrentMonth: ALL_IN,
            hasEntry: [false, false, true, false, false, false, false],
            todayYmd: '2026-06-08', frequency: 'weekly',
        });
        expect(withEntry.every(v => !v)).toBe(true);

        const inProgress = computeMissedDays({
            days: WEEK, inCurrentMonth: ALL_IN, hasEntry: WEEK.map(() => false),
            todayYmd: '2026-06-07', frequency: 'weekly',
        });
        expect(inProgress.every(v => !v)).toBe(true);
    });

    it('is junk-safe on mismatched array lengths', () => {
        expect(computeMissedDays({
            days: WEEK, inCurrentMonth: [true], hasEntry: ALL_IN,
            todayYmd: '2026-06-08', frequency: 'daily',
        })).toEqual(WEEK.map(() => false));
    });
});
