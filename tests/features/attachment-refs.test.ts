/**
 * Backup import rewrites embedded attachment URLs to their new post-import ids.
 * Regression: a per-id replaceAll loop collides on shared prefixes
 * (/api/attachment/1 ⊂ /api/attachment/15), corrupting longer ids. The
 * single-pass remapper must rewrite each full id exactly once.
 */
import { describe, it, expect } from 'vitest';
import { remapAttachmentRefs, remapEntryRefs } from '../../src/lib/attachmentRefs';

describe('remapEntryRefs', () => {
    it('rewrites journal://entry/{id} hrefs and data-entry-id to new ids', () => {
        const map = new Map([[3, 100], [30, 7]]);
        const html = '<a href="journal://entry/3" data-entry-id="3">x</a> <a href="journal://entry/30" data-entry-id="30">y</a>';
        expect(remapEntryRefs(html, map)).toBe(
            '<a href="journal://entry/100" data-entry-id="100">x</a> <a href="journal://entry/7" data-entry-id="7">y</a>'
        );
    });
    it('does not collide on shared id prefixes (3 vs 30)', () => {
        const map = new Map([[3, 100], [30, 7]]);
        expect(remapEntryRefs('journal://entry/30', map)).toBe('journal://entry/7');
    });
    it('leaves unmapped ids untouched', () => {
        expect(remapEntryRefs('journal://entry/9 data-entry-id="9"', new Map([[3, 100]])))
            .toBe('journal://entry/9 data-entry-id="9"');
    });
});

describe('remapAttachmentRefs', () => {
    it('rewrites each id to its mapped value', () => {
        const map = new Map([[1, 50], [2, 51]]);
        expect(remapAttachmentRefs('<img src="/api/attachment/1">', map))
            .toBe('<img src="/api/attachment/50">');
        expect(remapAttachmentRefs('/api/attachment/2', map)).toBe('/api/attachment/51');
    });

    it('does NOT corrupt longer ids that share a prefix (the collision bug)', () => {
        // 1→50, 15→3, 150→7. A naive loop processing id 1 first turns
        // "/api/attachment/15" into "/api/attachment/505".
        const map = new Map([[1, 50], [15, 3], [150, 7]]);
        const input = '/api/attachment/1 /api/attachment/15 /api/attachment/150';
        expect(remapAttachmentRefs(input, map))
            .toBe('/api/attachment/50 /api/attachment/3 /api/attachment/7');
    });

    it('handles real img markup and multiple references', () => {
        const map = new Map([[3, 100], [30, 200]]);
        const html = '<p><img src="/api/attachment/3"><img src="/api/attachment/30"></p>';
        expect(remapAttachmentRefs(html, map))
            .toBe('<p><img src="/api/attachment/100"><img src="/api/attachment/200"></p>');
    });

    it('leaves unmapped ids untouched', () => {
        const map = new Map([[1, 50]]);
        expect(remapAttachmentRefs('/api/attachment/9', map)).toBe('/api/attachment/9');
    });

    it('is order-independent across the id map', () => {
        // Same map built in the opposite order must give the same result.
        const a = new Map([[150, 7], [15, 3], [1, 50]]);
        const input = '/api/attachment/150 /api/attachment/15 /api/attachment/1';
        expect(remapAttachmentRefs(input, a))
            .toBe('/api/attachment/7 /api/attachment/3 /api/attachment/50');
    });
});
