/**
 * Feature: Auto-link bare URLs in text.
 *  - autoLinkUrls(html) finds http(s)://... in text nodes and wraps in <a>
 *  - Existing <a> tags are NOT re-wrapped
 *  - URL inside an attribute value is not touched
 *  - Trailing punctuation (., , ! ? ; :) is excluded from the link
 */
import { describe, it, expect } from 'vitest';
import { autoLinkUrls } from '../../src/lib/autolink';

describe('autoLinkUrls', () => {
    it('wraps a bare URL in text', () => {
        const out = autoLinkUrls('<p>visit https://example.com today</p>');
        expect(out).toContain('<a href="https://example.com"');
        expect(out).toContain('>https://example.com</a>');
    });

    it('handles multiple URLs on one line', () => {
        const out = autoLinkUrls('<p>see https://a.com and https://b.com</p>');
        expect((out.match(/<a /g) ?? []).length).toBe(2);
    });

    it('does NOT re-wrap URLs already inside an anchor', () => {
        const html = '<p><a href="https://example.com">click</a></p>';
        expect(autoLinkUrls(html)).toBe(html);
    });

    it('strips trailing punctuation from the link', () => {
        const out = autoLinkUrls('<p>see https://example.com.</p>');
        expect(out).toContain('href="https://example.com"');
        expect(out).toContain('</a>.</p>');
    });

    it('handles URL with path + query + hash', () => {
        const out = autoLinkUrls('<p>https://x.com/path?q=1#frag</p>');
        expect(out).toContain('href="https://x.com/path?q=1#frag"');
    });

    it('does NOT touch URLs inside attribute values', () => {
        const html = '<p><img src="https://example.com/x.png" alt="see https://example.com" /></p>';
        const out = autoLinkUrls(html);
        // The src attribute survives intact
        expect(out).toContain('<img src="https://example.com/x.png"');
        // The alt attribute also untouched (still inside the tag)
        expect(out).toContain('alt="see https://example.com"');
    });

    it('escapes HTML metachars in surrounding text', () => {
        const out = autoLinkUrls('<p>a https://x.com b</p>');
        expect(out).toContain('a <a');
        expect(out).toContain('</a> b');
    });

    it('handles input with no URLs unchanged', () => {
        expect(autoLinkUrls('<p>plain text</p>')).toBe('<p>plain text</p>');
    });

    it('does not match malformed URLs', () => {
        expect(autoLinkUrls('<p>http:// foo</p>')).not.toContain('<a ');
        expect(autoLinkUrls('<p>htttp://x</p>')).not.toContain('<a ');
    });

    it('rel/target are set for safety', () => {
        const out = autoLinkUrls('<p>https://x.com</p>');
        expect(out).toContain('rel="noopener noreferrer"');
        expect(out).toContain('target="_blank"');
    });
});
