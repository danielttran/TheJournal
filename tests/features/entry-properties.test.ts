import { describe, it, expect } from 'vitest';
import { computeEntryStats } from '../../src/lib/entryProperties';

describe('computeEntryStats', () => {
    it('returns zeros for empty content', () => {
        expect(computeEntryStats('')).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0 });
        expect(computeEntryStats('<p></p>')).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0 });
    });

    it('counts words and characters from HTML', () => {
        const s = computeEntryStats('<p>Hello world</p>');
        expect(s.words).toBe(2);
        expect(s.characters).toBe(11);        // "Hello world"
        expect(s.charactersNoSpaces).toBe(10);
    });

    it('ignores tags and decodes entities', () => {
        const s = computeEntryStats('<h1>A &amp; B</h1><p>c</p>');
        // stripHtml → "A & B c"
        expect(s.words).toBe(4);
        expect(s.characters).toBe(7);
        expect(s.charactersNoSpaces).toBe(4); // A & B c → A&Bc
    });
});
