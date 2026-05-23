import { describe, it, expect } from 'vitest';
import { adjacentEntryId } from '../../src/lib/navOrder';

describe('adjacentEntryId', () => {
    const ids = [10, 20, 30, 40];

    it('returns null for an empty list', () => {
        expect(adjacentEntryId([], 10, 'next')).toBeNull();
        expect(adjacentEntryId([], null, 'prev')).toBeNull();
    });

    it('moves forward and backward within the list', () => {
        expect(adjacentEntryId(ids, 20, 'next')).toBe(30);
        expect(adjacentEntryId(ids, 30, 'prev')).toBe(20);
    });

    it('does not wrap at the ends', () => {
        expect(adjacentEntryId(ids, 40, 'next')).toBeNull();
        expect(adjacentEntryId(ids, 10, 'prev')).toBeNull();
    });

    it('with no current selection, next picks first and prev picks last', () => {
        expect(adjacentEntryId(ids, null, 'next')).toBe(10);
        expect(adjacentEntryId(ids, null, 'prev')).toBe(40);
    });

    it('falls back to an edge when current id is not visible', () => {
        expect(adjacentEntryId(ids, 999, 'next')).toBe(10);
        expect(adjacentEntryId(ids, 999, 'prev')).toBe(40);
    });
});
