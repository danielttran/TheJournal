import { describe, it, expect } from 'vitest';
import { normalizeCreatedDate, CREATED_DATE_SHAPE } from '../../src/lib/entryDate';

describe('normalizeCreatedDate (J8 Change Entry Date/Time)', () => {
    it('stores a bare date at noon (by-date convention)', () => {
        expect(normalizeCreatedDate('2026-06-09')).toBe('2026-06-09 12:00:00');
    });

    it('appends seconds to an HH:MM timestamp', () => {
        expect(normalizeCreatedDate('2026-06-09 08:30')).toBe('2026-06-09 08:30:00');
    });

    it('passes a full timestamp through unchanged', () => {
        expect(normalizeCreatedDate('2026-06-09 23:59:59')).toBe('2026-06-09 23:59:59');
    });

    it('rejects impossible dates the shape regex cannot catch', () => {
        expect(normalizeCreatedDate('2026-13-01')).toBeNull();      // month 13
        expect(normalizeCreatedDate('2026-02-30')).toBeNull();      // Feb 30
        expect(normalizeCreatedDate('2025-02-29')).toBeNull();      // non-leap Feb 29
        expect(normalizeCreatedDate('2026-06-09 24:00')).toBeNull(); // hour 24
        expect(normalizeCreatedDate('2026-06-09 12:60')).toBeNull(); // minute 60
    });

    it('accepts leap-day on a leap year', () => {
        expect(normalizeCreatedDate('2024-02-29')).toBe('2024-02-29 12:00:00');
    });

    it('rejects malformed shapes outright', () => {
        for (const bad of ['', 'tomorrow', '2026/06/09', '2026-06-09T10:00', '2026-6-9', '2026-06-09 1:00']) {
            expect(normalizeCreatedDate(bad)).toBeNull();
            expect(CREATED_DATE_SHAPE.test(bad)).toBe(false);
        }
    });
});
