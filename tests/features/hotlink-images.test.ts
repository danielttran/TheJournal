/**
 * Feature: Hot-link images by URL
 *  - isSafeImageUrl(s) returns true only for http(s):// URLs with image-like extensions
 *  - rejects javascript:, data:, file:, vbscript:, ftp:
 *  - autoEmbedImageUrls(html) detects bare URLs on their own line ending in an image
 *    extension and wraps them in <img> tags
 */
import { describe, it, expect } from 'vitest';
import { isSafeImageUrl, autoEmbedImageUrls } from '../../src/lib/hotlinkImages';

describe('isSafeImageUrl', () => {
    it('accepts http(s) image URLs', () => {
        expect(isSafeImageUrl('https://example.com/foo.png')).toBe(true);
        expect(isSafeImageUrl('http://example.com/bar.jpg')).toBe(true);
        expect(isSafeImageUrl('https://x.com/y/z.webp?v=1')).toBe(true);
        expect(isSafeImageUrl('https://x.com/y.gif#frag')).toBe(true);
        expect(isSafeImageUrl('https://x.com/y.JPEG')).toBe(true);
    });

    it('rejects unsafe protocols', () => {
        expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
        expect(isSafeImageUrl('data:text/html,<script>')).toBe(false);
        expect(isSafeImageUrl('file:///c:/secrets.png')).toBe(false);
        expect(isSafeImageUrl('vbscript:msgbox')).toBe(false);
    });

    it('rejects non-image extensions', () => {
        expect(isSafeImageUrl('https://example.com/foo.html')).toBe(false);
        expect(isSafeImageUrl('https://example.com/foo')).toBe(false);
        expect(isSafeImageUrl('https://example.com/foo.exe')).toBe(false);
    });

    it('rejects bare hostnames + relative paths', () => {
        expect(isSafeImageUrl('example.com/foo.png')).toBe(false);
        expect(isSafeImageUrl('/local.png')).toBe(false);
        expect(isSafeImageUrl('')).toBe(false);
    });
});

describe('autoEmbedImageUrls', () => {
    it('wraps a standalone image URL line in <img>', () => {
        const out = autoEmbedImageUrls('<p>https://example.com/foo.png</p>');
        expect(out).toContain('<img src="https://example.com/foo.png"');
    });

    it('does not embed unsafe URLs', () => {
        const out = autoEmbedImageUrls('<p>javascript:alert(1)</p>');
        expect(out).toContain('javascript:alert(1)');
        expect(out).not.toContain('<img');
    });

    it('does not double-wrap existing <img> tags', () => {
        const html = '<img src="https://example.com/foo.png" />';
        expect(autoEmbedImageUrls(html)).toBe(html);
    });

    it('leaves inline URLs (mixed with text) alone', () => {
        const html = '<p>see https://x.com/y.png for details</p>';
        const out = autoEmbedImageUrls(html);
        // Mixed-with-text URL is NOT auto-embedded; only standalone URLs are
        expect(out).toContain('see https://x.com/y.png for details');
        expect(out).not.toContain('<img');
    });
});
