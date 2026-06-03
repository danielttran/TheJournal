/**
 * M4.12 — Regex search.
 *
 * Pure-function helpers:
 *  - compileSafeRegex(pattern, { matchCase }) — wraps `new RegExp` with a
 *    bounded backtracking guard, throws SafeRegexError on invalid input
 *    or patterns that look catastrophic (nested quantifiers).
 *  - matchEntryAgainstRegex(re, { title, plainContent, searchIn }) —
 *    returns { titleMatch, contentMatch, any } so the route can decide
 *    whether to include the row.
 */
import { describe, it, expect } from 'vitest';
import {
    compileSafeRegex,
    matchEntryAgainstRegex,
    SafeRegexError,
} from '../../src/lib/regexSearch';

describe('compileSafeRegex', () => {
    it('compiles a simple pattern', () => {
        const re = compileSafeRegex('hello', { matchCase: false });
        expect(re.test('Hello world')).toBe(true);
        expect(re.test('Goodbye')).toBe(false);
    });

    it('honours matchCase', () => {
        const re = compileSafeRegex('Foo', { matchCase: true });
        expect(re.test('Foo')).toBe(true);
        expect(re.test('foo')).toBe(false);
    });

    it('throws SafeRegexError on a malformed pattern', () => {
        expect(() => compileSafeRegex('(', { matchCase: false })).toThrow(SafeRegexError);
        expect(() => compileSafeRegex('[a-', { matchCase: false })).toThrow(SafeRegexError);
    });

    it('rejects patterns with nested quantifiers (ReDoS heuristic)', () => {
        expect(() => compileSafeRegex('(a+)+', { matchCase: false })).toThrow(SafeRegexError);
        expect(() => compileSafeRegex('(a*)*b', { matchCase: false })).toThrow(SafeRegexError);
        expect(() => compileSafeRegex('(a+)*', { matchCase: false })).toThrow(SafeRegexError);
    });

    it('rejects brace-quantified and alternation ReDoS shapes', () => {
        // These compile under a naive [+*]-only guard but still backtrack
        // catastrophically. (a{1,2})+ on "aaa…!" is exponential.
        expect(() => compileSafeRegex('(a{1,2})+$', { matchCase: false })).toThrow(SafeRegexError);
        expect(() => compileSafeRegex('(a+){1,50}', { matchCase: false })).toThrow(SafeRegexError);
        expect(() => compileSafeRegex('(a|aa)+$', { matchCase: false })).toThrow(SafeRegexError);
        expect(() => compileSafeRegex('(\\S+)+', { matchCase: false })).toThrow(SafeRegexError);
    });

    it('still accepts safe groups, alternation, and non-capturing groups', () => {
        // No outer quantifier on the group, or no inner quantifier/alternation.
        expect(() => compileSafeRegex('(foo|bar)', { matchCase: false })).not.toThrow();
        expect(() => compileSafeRegex('(ab)+', { matchCase: false })).not.toThrow();
        expect(() => compileSafeRegex('(?:ab)+', { matchCase: false })).not.toThrow();
        expect(() => compileSafeRegex('\\d{1,3}\\.\\d{1,3}', { matchCase: false })).not.toThrow();
    });

    it('rejects empty patterns', () => {
        expect(() => compileSafeRegex('', { matchCase: false })).toThrow(SafeRegexError);
        expect(() => compileSafeRegex('   ', { matchCase: false })).toThrow(SafeRegexError);
    });

    it('rejects absurdly long patterns', () => {
        const long = 'a'.repeat(2000);
        expect(() => compileSafeRegex(long, { matchCase: false })).toThrow(SafeRegexError);
    });
});

describe('matchEntryAgainstRegex', () => {
    const re = /^TODO/m;

    it('searches title only when searchIn is "title"', () => {
        const out = matchEntryAgainstRegex(re, {
            title: 'TODO triage',
            plainContent: 'TODO inside content',
            searchIn: 'title',
        });
        expect(out.titleMatch).toBe(true);
        expect(out.contentMatch).toBe(false);
        expect(out.any).toBe(true);
    });

    it('searches content only when searchIn is "content"', () => {
        const out = matchEntryAgainstRegex(re, {
            title: 'TODO triage',
            plainContent: 'no todos here',
            searchIn: 'content',
        });
        expect(out.titleMatch).toBe(false);
        expect(out.contentMatch).toBe(false);
        expect(out.any).toBe(false);
    });

    it('searches both with default "both"', () => {
        const out = matchEntryAgainstRegex(re, {
            title: 'meeting notes',
            plainContent: '\nTODO follow up',
            searchIn: 'both',
        });
        expect(out.titleMatch).toBe(false);
        expect(out.contentMatch).toBe(true);
        expect(out.any).toBe(true);
    });

    it('handles null/empty content', () => {
        const out = matchEntryAgainstRegex(/x/, {
            title: '',
            plainContent: null,
            searchIn: 'both',
        });
        expect(out.any).toBe(false);
    });
});
