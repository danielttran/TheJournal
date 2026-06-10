import { describe, it, expect } from 'vitest';
import { adjacentCategoryId } from '../../src/lib/categoryCycle';

describe('adjacentCategoryId (Ctrl+Tab category cycling)', () => {
    const ids = [10, 20, 30];

    it('moves forward and backward', () => {
        expect(adjacentCategoryId(ids, 10, 1)).toBe(20);
        expect(adjacentCategoryId(ids, 20, -1)).toBe(10);
    });

    it('wraps around both ends', () => {
        expect(adjacentCategoryId(ids, 30, 1)).toBe(10);
        expect(adjacentCategoryId(ids, 10, -1)).toBe(30);
    });

    it('falls back to the first tab when nothing is active', () => {
        expect(adjacentCategoryId(ids, null, 1)).toBe(10);
        expect(adjacentCategoryId(ids, 999, -1)).toBe(10);
    });

    it('returns null when there is nowhere to go', () => {
        expect(adjacentCategoryId([], 1, 1)).toBeNull();
        expect(adjacentCategoryId([10], 10, 1)).toBeNull();
    });
});
