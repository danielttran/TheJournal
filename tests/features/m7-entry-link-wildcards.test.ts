/**
 * M7.19 — Entry link wildcards.
 *
 * DavidRM lets users write links like `entry:Daily Journal\*` where the
 * left side is the category and the right side is a glob title pattern.
 * We expose a pure helper that the lookup route + future link picker
 * both call.
 *
 *   parseEntryRef("Daily Journal\\Trip*") → { categoryName: 'Daily Journal', titlePattern: 'Trip*' }
 *   parseEntryRef("Just A Title")         → { titlePattern: 'Just A Title' }
 *
 *   matchesGlob("Trip-2025", "Trip*") → true
 *   matchesGlob("trip-2025", "Trip*") → true (case-insensitive)
 *   matchesGlob("FooBar",    "*Bar")  → true
 */
import { describe, it, expect } from 'vitest';
import { parseEntryRef, matchesGlob, globToSqlLike } from '../../src/lib/entryRefs';

describe('parseEntryRef', () => {
    it('parses bare title', () => {
        expect(parseEntryRef('Trip')).toEqual({ titlePattern: 'Trip' });
    });

    it('parses category\\title pattern', () => {
        expect(parseEntryRef('Daily Journal\\Trip*')).toEqual({
            categoryName: 'Daily Journal',
            titlePattern: 'Trip*',
        });
    });

    it('parses "*" as match-everything in a category', () => {
        expect(parseEntryRef('Notebook\\*')).toEqual({
            categoryName: 'Notebook',
            titlePattern: '*',
        });
    });

    it('trims whitespace from each part', () => {
        expect(parseEntryRef('  Daily Journal  \\  Trip  ')).toEqual({
            categoryName: 'Daily Journal',
            titlePattern: 'Trip',
        });
    });

    it('returns null for empty input', () => {
        expect(parseEntryRef('')).toBeNull();
        expect(parseEntryRef('  ')).toBeNull();
        expect(parseEntryRef('Foo\\')).toBeNull(); // empty title part
    });
});

describe('matchesGlob', () => {
    it('matches simple text', () => {
        expect(matchesGlob('hello', 'hello')).toBe(true);
        expect(matchesGlob('hello', 'world')).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(matchesGlob('Hello', 'hello')).toBe(true);
        expect(matchesGlob('HELLO', 'hELLo')).toBe(true);
    });

    it('honours * wildcards', () => {
        expect(matchesGlob('Trip-2025', 'Trip*')).toBe(true);
        expect(matchesGlob('Trip-2025', '*-2025')).toBe(true);
        expect(matchesGlob('FooBar', '*Bar')).toBe(true);
        expect(matchesGlob('FooBar', 'Foo*Bar')).toBe(true);
        expect(matchesGlob('FooBar', '*')).toBe(true);
        expect(matchesGlob('FooBar', 'Baz*')).toBe(false);
    });

    it('honours ? as single-char wildcard', () => {
        expect(matchesGlob('cat', 'c?t')).toBe(true);
        expect(matchesGlob('cart', 'c?t')).toBe(false);
    });

    it('escapes regex metacharacters in the pattern', () => {
        expect(matchesGlob('a.b', 'a.b')).toBe(true);
        expect(matchesGlob('axb', 'a.b')).toBe(false);  // '.' is literal, not regex
        expect(matchesGlob('a(b)', 'a(b)')).toBe(true);
        expect(matchesGlob('a$b', 'a$b')).toBe(true);
    });
});

describe('globToSqlLike', () => {
    it('expands * to %', () => {
        expect(globToSqlLike('Trip*')).toBe('Trip%');
        expect(globToSqlLike('*end')).toBe('%end');
        expect(globToSqlLike('a*b*c')).toBe('a%b%c');
    });

    it('expands ? to _', () => {
        expect(globToSqlLike('c?t')).toBe('c_t');
        expect(globToSqlLike('???')).toBe('___');
    });

    it('escapes literal % so it is not treated as a SQL wildcard', () => {
        expect(globToSqlLike('100%')).toBe('100\\%');
        // Combined: literal % followed by glob *.
        expect(globToSqlLike('100%*')).toBe('100\\%%');
    });

    it('escapes literal _ so it is not treated as a SQL single-char wildcard', () => {
        expect(globToSqlLike('snake_case')).toBe('snake\\_case');
        expect(globToSqlLike('foo_*')).toBe('foo\\_%');
    });

    it('escapes literal backslashes', () => {
        // A literal backslash in the user input becomes \\ for the ESCAPE '\\' clause.
        expect(globToSqlLike('path\\to')).toBe('path\\\\to');
    });

    it('handles the all-wildcard case (caller is expected to refuse this with no scope)', () => {
        expect(globToSqlLike('*')).toBe('%');
        expect(globToSqlLike('**')).toBe('%%');
    });
});
