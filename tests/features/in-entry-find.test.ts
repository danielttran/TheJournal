import { describe, it, expect } from 'vitest';
import {
    escapeRegExp,
    buildSearchRegExp,
    findMatchesInText,
    countMatches,
    stepIndex,
} from '../../src/lib/inEntryFind';

describe('escapeRegExp', () => {
    it('escapes regex metacharacters', () => {
        expect(escapeRegExp('a.b*c+?')).toBe('a\\.b\\*c\\+\\?');
        expect(escapeRegExp('(x)[y]{z}')).toBe('\\(x\\)\\[y\\]\\{z\\}');
    });
});

describe('buildSearchRegExp', () => {
    it('returns null for an empty query', () => {
        expect(buildSearchRegExp('')).toBeNull();
    });

    it('is case-insensitive by default and case-sensitive on request', () => {
        expect(buildSearchRegExp('Cat')!.flags).toBe('gi');
        expect(buildSearchRegExp('Cat', { caseSensitive: true })!.flags).toBe('g');
    });

    it('treats the query literally unless regex mode is on', () => {
        // "a.c" as a literal must not match "abc"
        expect('abc'.match(buildSearchRegExp('a.c')!)).toBeNull();
        // in regex mode the dot is a wildcard
        expect('abc'.match(buildSearchRegExp('a.c', { regex: true })!)).not.toBeNull();
    });

    it('wraps in word boundaries for whole-word mode', () => {
        const re = buildSearchRegExp('cat', { wholeWord: true })!;
        expect('a cat sat'.match(re)).not.toBeNull();
        expect(buildSearchRegExp('cat', { wholeWord: true })!.test('category')).toBe(false);
    });

    it('returns null for an invalid regex instead of throwing', () => {
        expect(buildSearchRegExp('(', { regex: true })).toBeNull();
    });
});

describe('findMatchesInText', () => {
    it('finds all non-overlapping matches with start/end offsets', () => {
        const m = findMatchesInText('the cat and the cat', 'cat');
        expect(m).toEqual([
            { start: 4, end: 7 },
            { start: 16, end: 19 },
        ]);
    });

    it('honours case sensitivity', () => {
        expect(findMatchesInText('Cat cat CAT', 'cat')).toHaveLength(3);
        expect(findMatchesInText('Cat cat CAT', 'cat', { caseSensitive: true })).toHaveLength(1);
    });

    it('returns nothing for an empty query or empty text', () => {
        expect(findMatchesInText('hello', '')).toEqual([]);
        expect(findMatchesInText('', 'x')).toEqual([]);
    });

    it('does not loop forever on a zero-width regex match', () => {
        // `a*` matches empty string everywhere; we must skip zero-width hits.
        const m = findMatchesInText('bbab', 'a*', { regex: true });
        expect(m).toEqual([{ start: 2, end: 3 }]);
    });

    it('supports whole-word matching', () => {
        const m = findMatchesInText('cat category cat', 'cat', { wholeWord: true });
        expect(m).toEqual([
            { start: 0, end: 3 },
            { start: 13, end: 16 },
        ]);
    });
});

describe('countMatches', () => {
    it('sums matches across fragments (per-text-node behaviour)', () => {
        expect(countMatches(['a cat', 'cat cat', 'dog'], 'cat')).toBe(3);
    });
});

describe('stepIndex', () => {
    it('wraps forward and backward', () => {
        expect(stepIndex(3, 0, 1)).toBe(1);
        expect(stepIndex(3, 2, 1)).toBe(0);
        expect(stepIndex(3, 0, -1)).toBe(2);
        expect(stepIndex(3, 2, -1)).toBe(1);
    });

    it('returns 0 when there are no matches', () => {
        expect(stepIndex(0, 0, 1)).toBe(0);
        expect(stepIndex(0, 5, -1)).toBe(0);
    });
});
