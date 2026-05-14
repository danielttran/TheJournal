/**
 * Feature: per-entry reading time + word count (David RM parity)
 */
import { describe, it, expect } from 'vitest';
import { stripHtml, wordCount, readingTimeMinutes, readingTimeMinutesFromWords, readingTimeLabel } from '../../src/lib/readingTime';

describe('stripHtml', () => {
    it('drops tags and decodes common entities', () => {
        expect(stripHtml('<p>hello <b>world</b></p>')).toBe('hello world');
        expect(stripHtml('a&nbsp;b')).toBe('a b');
        expect(stripHtml('Tom &amp; Jerry')).toBe('Tom & Jerry');
        expect(stripHtml('&lt;tag&gt;')).toBe('<tag>');
        expect(stripHtml('&quot;quoted&quot;')).toBe('"quoted"');
        expect(stripHtml("it&#39;s")).toBe("it's");
    });

    it('collapses runs of whitespace', () => {
        expect(stripHtml('<p>a</p>   <p>b</p>')).toBe('a b');
        expect(stripHtml('  spaced   out  ')).toBe('spaced out');
    });

    it('returns empty for empty/null', () => {
        expect(stripHtml('')).toBe('');
        // @ts-expect-error — defensive null check
        expect(stripHtml(null)).toBe('');
    });
});

describe('wordCount', () => {
    it('counts plain words', () => {
        expect(wordCount('the quick brown fox')).toBe(4);
    });

    it('counts words inside HTML tags', () => {
        expect(wordCount('<p>the <b>quick</b> brown <i>fox</i></p>')).toBe(4);
    });

    it('returns 0 for empty input', () => {
        expect(wordCount('')).toBe(0);
        expect(wordCount('<p></p>')).toBe(0);
        expect(wordCount('   ')).toBe(0);
    });

    it('does not double-count whitespace runs', () => {
        expect(wordCount('a     b')).toBe(2);
        expect(wordCount('<p>a</p>\n\n<p>b</p>')).toBe(2);
    });
});

describe('readingTimeMinutes', () => {
    it('returns 0 for empty content', () => {
        expect(readingTimeMinutes('')).toBe(0);
        expect(readingTimeMinutes('<p></p>')).toBe(0);
    });

    it('returns 1 minute for a single word', () => {
        // Minimum read time is 1 minute when there is ANY content.
        expect(readingTimeMinutes('hi')).toBe(1);
    });

    it('scales with word count at 225 WPM default', () => {
        const words = Array(225).fill('w').join(' ');
        expect(readingTimeMinutes(words)).toBe(1);

        const longer = Array(225 * 5).fill('w').join(' ');
        expect(readingTimeMinutes(longer)).toBe(5);
    });

    it('rounds up so a partial minute still shows 1', () => {
        const words = Array(100).fill('w').join(' ');
        expect(readingTimeMinutes(words)).toBe(1);
    });

    it('honours a custom WPM', () => {
        const words = Array(300).fill('w').join(' ');
        expect(readingTimeMinutes(words, 100)).toBe(3);
        expect(readingTimeMinutes(words, 600)).toBe(1);
    });

    it('falls back to default WPM for non-positive values', () => {
        const words = Array(225).fill('w').join(' ');
        expect(readingTimeMinutes(words, 0)).toBe(1);
        expect(readingTimeMinutes(words, -50)).toBe(1);
    });
});

describe('readingTimeMinutesFromWords', () => {
    it('returns 0 for non-positive counts', () => {
        expect(readingTimeMinutesFromWords(0)).toBe(0);
        expect(readingTimeMinutesFromWords(-5)).toBe(0);
    });

    it('matches readingTimeMinutes for identical word counts', () => {
        const words = Array(500).fill('w').join(' ');
        expect(readingTimeMinutesFromWords(wordCount(words)))
            .toBe(readingTimeMinutes(words));
    });

    it('rejects non-finite input', () => {
        expect(readingTimeMinutesFromWords(NaN)).toBe(0);
        expect(readingTimeMinutesFromWords(Infinity)).toBe(0);
    });

    it('honours a custom WPM', () => {
        expect(readingTimeMinutesFromWords(300, 100)).toBe(3);
        expect(readingTimeMinutesFromWords(300, 600)).toBe(1);
    });
});

describe('readingTimeLabel', () => {
    it('formats minutes as "N min read"', () => {
        expect(readingTimeLabel('hi')).toBe('1 min read');
        expect(readingTimeLabel(Array(500).fill('w').join(' '))).toBe('3 min read');
    });

    it('returns empty string for empty content', () => {
        expect(readingTimeLabel('')).toBe('');
        expect(readingTimeLabel('<p></p>')).toBe('');
    });
});
