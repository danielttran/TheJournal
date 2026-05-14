/**
 * Auto-rotating daily writing prompts.
 *  - promptOfTheDay(date) returns a deterministic prompt indexed by day-of-year
 *  - Same date input → same prompt
 *  - Adjacent days → different prompts (modulo the list length)
 *  - DAILY_PROMPTS has >= 30 entries
 */
import { describe, it, expect } from 'vitest';
import { promptOfTheDay, DAILY_PROMPTS } from '../../src/lib/dailyPrompts';

describe('DAILY_PROMPTS list', () => {
    it('contains at least 30 prompts', () => {
        expect(DAILY_PROMPTS.length).toBeGreaterThanOrEqual(30);
    });

    it('contains no duplicates', () => {
        const set = new Set(DAILY_PROMPTS);
        expect(set.size).toBe(DAILY_PROMPTS.length);
    });

    it('every prompt is a non-empty string', () => {
        for (const p of DAILY_PROMPTS) {
            expect(typeof p).toBe('string');
            expect(p.length).toBeGreaterThan(5);
        }
    });
});

describe('promptOfTheDay', () => {
    it('returns the same prompt for the same date', () => {
        const d = new Date('2026-05-13T08:00:00Z');
        expect(promptOfTheDay(d)).toBe(promptOfTheDay(d));
    });

    it('returns a different prompt for adjacent days', () => {
        const a = new Date('2026-05-13T08:00:00Z');
        const b = new Date('2026-05-14T08:00:00Z');
        expect(promptOfTheDay(a)).not.toBe(promptOfTheDay(b));
    });

    it('cycles through prompts deterministically', () => {
        const len = DAILY_PROMPTS.length;
        // Days N and N+len should produce the same prompt
        const a = new Date('2025-01-01T00:00:00Z');
        const b = new Date(a.getTime() + len * 86400000);
        expect(promptOfTheDay(a)).toBe(promptOfTheDay(b));
    });

    it('returns a string from DAILY_PROMPTS', () => {
        const p = promptOfTheDay(new Date());
        expect(DAILY_PROMPTS).toContain(p);
    });

    it('is robust to invalid input — falls back to today', () => {
        expect(typeof promptOfTheDay(new Date('not-a-date'))).toBe('string');
    });
});
