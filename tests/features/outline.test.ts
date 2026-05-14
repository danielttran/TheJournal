/**
 * Feature: Outline / TOC from headings
 *  - extractOutline(html) → [{level, text, anchor}]
 *  - Slugs are URL-safe and unique (collision suffix _2, _3, …)
 *  - injectHeadingIds(html) returns HTML with `id="slug"` on every h1-h6
 *  - Empty input returns []
 */
import { describe, it, expect } from 'vitest';
import { extractOutline, injectHeadingIds, slugify } from '../../src/lib/outline';

describe('slugify', () => {
    it('lowercases + dashes spaces', () => {
        expect(slugify('Hello World')).toBe('hello-world');
    });
    it('strips special chars', () => {
        expect(slugify('Hi! How? are/you')).toBe('hi-how-are-you');
    });
    it('collapses consecutive dashes', () => {
        expect(slugify('a---b')).toBe('a-b');
    });
    it('handles empty / whitespace', () => {
        expect(slugify('')).toBe('');
        expect(slugify('   ')).toBe('');
    });
});

describe('extractOutline', () => {
    it('extracts nested headings with levels and slugs', () => {
        const html = '<h1>First</h1><h2>Sub</h2><h3>Deep</h3><h1>Second</h1>';
        const out = extractOutline(html);
        expect(out).toEqual([
            { level: 1, text: 'First', anchor: 'first' },
            { level: 2, text: 'Sub', anchor: 'sub' },
            { level: 3, text: 'Deep', anchor: 'deep' },
            { level: 1, text: 'Second', anchor: 'second' },
        ]);
    });

    it('strips inline formatting from heading text', () => {
        const html = '<h1>Hello <strong>World</strong>!</h1>';
        expect(extractOutline(html)).toEqual([{ level: 1, text: 'Hello World!', anchor: 'hello-world' }]);
    });

    it('disambiguates duplicate slugs with -2, -3, …', () => {
        const html = '<h1>Notes</h1><h2>Notes</h2><h2>Notes</h2>';
        const out = extractOutline(html);
        expect(out.map(o => o.anchor)).toEqual(['notes', 'notes-2', 'notes-3']);
    });

    it('returns empty for input with no headings', () => {
        expect(extractOutline('<p>plain</p>')).toEqual([]);
    });

    it('handles empty input', () => {
        expect(extractOutline('')).toEqual([]);
    });
});

describe('injectHeadingIds', () => {
    it('adds id attributes to every heading', () => {
        const out = injectHeadingIds('<h1>Title</h1><p>body</p><h2>Section</h2>');
        expect(out).toContain('<h1 id="title">Title</h1>');
        expect(out).toContain('<h2 id="section">Section</h2>');
    });

    it('preserves existing attributes', () => {
        const out = injectHeadingIds('<h2 class="foo">Hello</h2>');
        expect(out).toContain('class="foo"');
        expect(out).toContain('id="hello"');
    });

    it('does not double-add id if already present', () => {
        const html = '<h2 id="custom">Hello</h2>';
        expect(injectHeadingIds(html)).toBe(html);
    });

    it('disambiguates duplicate slugs consistently with extractOutline', () => {
        const html = '<h1>X</h1><h1>X</h1>';
        const out = injectHeadingIds(html);
        expect(out).toContain('<h1 id="x">');
        expect(out).toContain('<h1 id="x-2">');
    });
});
