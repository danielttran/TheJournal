/**
 * Multi-format export.
 *  - htmlToPlainText(html) — strip tags, preserve paragraph breaks
 *  - exportEntryAsHTML(fm, html) — standalone HTML doc with title + body
 *  - exportEntryAsATOM(items, feedTitle) — ATOM 1.0 feed XML
 */
import { describe, it, expect } from 'vitest';
import { htmlToPlainText, exportEntryAsHTML, exportEntriesAsATOM } from '../../src/lib/export-formats';

describe('htmlToPlainText', () => {
    it('preserves paragraph breaks as double newlines', () => {
        expect(htmlToPlainText('<p>one</p><p>two</p>')).toBe('one\n\ntwo');
    });

    it('preserves <br> as a single newline', () => {
        expect(htmlToPlainText('<p>a<br>b</p>')).toBe('a\nb');
    });

    it('strips inline formatting', () => {
        expect(htmlToPlainText('<p><strong>bold</strong> <em>italic</em></p>')).toBe('bold italic');
    });

    it('decodes common entities', () => {
        expect(htmlToPlainText('<p>a&nbsp;&amp;&nbsp;b</p>')).toBe('a & b');
    });

    it('flattens list items to lines', () => {
        expect(htmlToPlainText('<ul><li>one</li><li>two</li></ul>')).toContain('one');
        expect(htmlToPlainText('<ul><li>one</li><li>two</li></ul>')).toContain('two');
    });

    it('handles empty/null input', () => {
        expect(htmlToPlainText('')).toBe('');
        expect(htmlToPlainText(null as any)).toBe('');
    });
});

describe('exportEntryAsHTML', () => {
    it('returns a full HTML document with title in <title> and content', () => {
        const out = exportEntryAsHTML({ title: 'My Day', createdDate: '2024-05-13', tags: ['work'] }, '<p>body</p>');
        expect(out).toContain('<!DOCTYPE html>');
        expect(out).toContain('<title>My Day</title>');
        expect(out).toContain('<p>body</p>');
        // Metadata block
        expect(out).toContain('My Day');
        expect(out).toContain('work');
    });

    it('escapes title in <title>', () => {
        const out = exportEntryAsHTML({ title: 'a <script>b</script>', tags: [] }, '<p></p>');
        expect(out).not.toContain('<title>a <script>');
        expect(out).toContain('&lt;script&gt;');
    });

    it('includes a <style> block so the file renders standalone', () => {
        const out = exportEntryAsHTML({ title: 'X', tags: [] }, '<p></p>');
        expect(out).toContain('<style>');
    });
});

describe('exportEntriesAsATOM', () => {
    const items = [
        { id: 1, title: 'One', html: '<p>one</p>', createdDate: '2024-05-13T12:00:00Z', modifiedDate: '2024-05-13T12:00:00Z' },
        { id: 2, title: 'Two & a Half', html: '<p>two</p>', createdDate: '2024-05-14T12:00:00Z', modifiedDate: '2024-05-14T12:00:00Z' },
    ];

    it('produces XML with feed/entry structure', () => {
        const out = exportEntriesAsATOM(items, 'My Journal');
        expect(out.startsWith('<?xml')).toBe(true);
        expect(out).toContain('<feed');
        expect(out).toContain('<title>My Journal</title>');
        expect(out).toContain('<entry>');
        expect(out.match(/<entry>/g)?.length).toBe(2);
    });

    it('escapes XML special chars in title + content', () => {
        const out = exportEntriesAsATOM(items, 'My & Journal');
        expect(out).toContain('My &amp; Journal');
        expect(out).toContain('Two &amp; a Half');
    });

    it('emits content as type="html" with HTML-escaped body', () => {
        const out = exportEntriesAsATOM(items, 'X');
        expect(out).toMatch(/<content\s+type="html">/);
        // <p>one</p> → &lt;p&gt;one&lt;/p&gt;
        expect(out).toContain('&lt;p&gt;one&lt;/p&gt;');
    });

    it('emits updated timestamps in ISO 8601', () => {
        const out = exportEntriesAsATOM(items, 'X');
        expect(out).toContain('2024-05-13T12:00:00Z');
        expect(out).toContain('2024-05-14T12:00:00Z');
    });

    it('handles empty entry list', () => {
        const out = exportEntriesAsATOM([], 'Empty');
        expect(out).toContain('<feed');
        expect(out).not.toContain('<entry>');
    });
});
