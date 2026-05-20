/**
 * htmlToPlainText was extracted from Editor.tsx where it was inlined without
 * tests. It powers preview-text derivation in the autosave hot path, so
 * regressions here directly corrupt entry previews and titles.
 *
 * Tests focus on the contract the autosave path depends on:
 *  - Block boundaries become newlines.
 *  - <style> and <script> CONTENT (not just tags) is stripped.
 *  - Common HTML entities are decoded.
 *  - Empty / null-ish inputs return an empty string.
 */
import { describe, it, expect } from 'vitest';
import { htmlToPlainText } from '../../src/lib/htmlText';

describe('htmlToPlainText', () => {
    it('returns empty string for empty input', () => {
        expect(htmlToPlainText('')).toBe('');
        // The function signature is `string` but defensive callers can still
        // pass null/undefined via casts — the truthy guard handles them.
        expect(htmlToPlainText(null as unknown as string)).toBe('');
        expect(htmlToPlainText(undefined as unknown as string)).toBe('');
    });

    it('strips simple tags', () => {
        expect(htmlToPlainText('<p>hello</p>')).toBe('hello\n');
        expect(htmlToPlainText('<span>a</span> <span>b</span>')).toBe('a b');
    });

    it('preserves block boundaries with newlines', () => {
        const html = '<p>line one</p><p>line two</p>';
        const out = htmlToPlainText(html);
        // Closing </p> emits \n; both paragraphs separated by a newline.
        expect(out).toBe('line one\nline two\n');
    });

    it('replaces <br> with a newline', () => {
        expect(htmlToPlainText('a<br>b<br/>c')).toBe('a\nb\nc');
    });

    it('strips the contents of <style> and <script>', () => {
        const html = '<style>body { color: red }</style><p>hi</p>';
        expect(htmlToPlainText(html)).toBe('hi\n');

        const xss = '<p>before</p><script>alert("x")</script><p>after</p>';
        expect(htmlToPlainText(xss)).toBe('before\nafter\n');
    });
});

describe('htmlToPlainText — entity decoding', () => {
    it('decodes &amp; to &', () => {
        expect(htmlToPlainText('a &amp; b')).toBe('a & b');
    });

    it('decodes &lt; and &gt;', () => {
        expect(htmlToPlainText('&lt;tag&gt;')).toBe('<tag>');
    });

    it('decodes &quot; and &#39; and &apos;', () => {
        expect(htmlToPlainText('&quot;hi&quot; &#39;x&#39; &apos;y&apos;'))
            .toBe('"hi" \'x\' \'y\'');
    });

    it('replaces &nbsp; with a regular space', () => {
        expect(htmlToPlainText('a&nbsp;b')).toBe('a b');
    });
});

describe('htmlToPlainText — heading and list blocks', () => {
    it('emits a newline after every closing heading tag h1..h6', () => {
        for (let i = 1; i <= 6; i++) {
            expect(htmlToPlainText(`<h${i}>x</h${i}>`)).toBe('x\n');
        }
    });

    it('emits a newline after </li> and </tr> too (mid-list previews)', () => {
        expect(htmlToPlainText('<li>a</li><li>b</li>')).toBe('a\nb\n');
        expect(htmlToPlainText('<tr>row1</tr><tr>row2</tr>')).toBe('row1\nrow2\n');
    });
});
