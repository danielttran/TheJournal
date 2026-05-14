/**
 * Feature: Word cloud
 *  - computeWordCloud(htmlStrings, opts) returns top-N words with frequencies.
 *  - Lowercases, strips HTML, drops stop-words, drops words shorter than minLength.
 *  - Sorted by count desc, then alphabetical for ties.
 */
import { describe, it, expect } from 'vitest';
import { computeWordCloud, STOP_WORDS } from '../../src/lib/wordcloud';

describe('computeWordCloud', () => {
    it('counts word occurrences across multiple HTML strings', () => {
        const out = computeWordCloud([
            '<p>apple banana apple</p>',
            '<p>banana cherry</p>',
        ], { limit: 5, minLength: 3 });
        const map = new Map(out.map(o => [o.word, o.count]));
        expect(map.get('apple')).toBe(2);
        expect(map.get('banana')).toBe(2);
        expect(map.get('cherry')).toBe(1);
    });

    it('lowercases — Apple and apple are the same word', () => {
        const out = computeWordCloud(['<p>Apple APPLE apple</p>'], { limit: 5, minLength: 3 });
        expect(out[0].word).toBe('apple');
        expect(out[0].count).toBe(3);
    });

    it('strips stop-words by default', () => {
        const out = computeWordCloud(['<p>the quick the brown the fox</p>'], { limit: 10, minLength: 3 });
        const words = out.map(o => o.word);
        expect(words).not.toContain('the');
        expect(words).toContain('quick');
    });

    it('drops words below minLength', () => {
        const out = computeWordCloud(['<p>a bb ccc dddd</p>'], { limit: 10, minLength: 3 });
        const words = out.map(o => o.word);
        expect(words).not.toContain('a');
        expect(words).not.toContain('bb');
        expect(words).toContain('ccc');
        expect(words).toContain('dddd');
    });

    it('limits to top N words by count desc', () => {
        const out = computeWordCloud([
            '<p>aa aa aa</p>',
            '<p>bb bb</p>',
            '<p>cc</p>',
        ], { limit: 2, minLength: 2 });
        expect(out.length).toBe(2);
        expect(out[0]).toMatchObject({ word: 'aa', count: 3 });
        expect(out[1]).toMatchObject({ word: 'bb', count: 2 });
    });

    it('strips punctuation but keeps hyphens within a word', () => {
        const out = computeWordCloud([
            '<p>self-care, self-care. self-care!</p>',
        ], { limit: 5, minLength: 3 });
        expect(out.find(o => o.word === 'self-care')?.count).toBe(3);
    });

    it('returns empty for empty input', () => {
        expect(computeWordCloud([], { limit: 5, minLength: 3 })).toEqual([]);
        expect(computeWordCloud([''], { limit: 5, minLength: 3 })).toEqual([]);
    });

    it('STOP_WORDS list is non-empty (sanity)', () => {
        expect(STOP_WORDS.size).toBeGreaterThan(20);
        expect(STOP_WORDS.has('the')).toBe(true);
        expect(STOP_WORDS.has('and')).toBe(true);
    });
});
