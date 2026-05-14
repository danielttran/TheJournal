/**
 * Feature: Internal entry-to-entry hyperlinks
 *  - resolveInternalLinks(html, lookup) replaces [[Title]] and [[#id]] with <a> tags
 *    using the lookup callback to map title→id and id→title.
 *  - Unresolved links get a broken-link class for styling.
 *  - HTML attribute contents are never touched.
 */
import { describe, it, expect } from 'vitest';
import { resolveInternalLinks, extractLinkTargets } from '../../src/lib/internalLinks';

const lookup = (q: string): { id: number; title: string } | null => {
    const byTitle: Record<string, { id: number; title: string }> = {
        'My Day': { id: 1, title: 'My Day' },
        'project plan': { id: 2, title: 'Project Plan' },
    };
    if (q.startsWith('#')) {
        const id = parseInt(q.slice(1), 10);
        for (const e of Object.values(byTitle)) if (e.id === id) return e;
        return null;
    }
    return byTitle[q.toLowerCase()] ?? byTitle[q] ?? null;
};

describe('resolveInternalLinks', () => {
    it('replaces [[Title]] with anchor when resolvable', () => {
        const html = '<p>see [[My Day]] for notes</p>';
        const out = resolveInternalLinks(html, lookup);
        expect(out).toContain('href="journal://entry/1"');
        expect(out).toContain('>My Day</a>');
    });

    it('matches title case-insensitively', () => {
        const html = '<p>[[project plan]]</p>';
        const out = resolveInternalLinks(html, lookup);
        expect(out).toContain('href="journal://entry/2"');
    });

    it('resolves [[#id]] form', () => {
        const html = '<p>[[#1]]</p>';
        const out = resolveInternalLinks(html, lookup);
        expect(out).toContain('href="journal://entry/1"');
    });

    it('marks unresolved links with broken-link class', () => {
        const html = '<p>[[Nonexistent]]</p>';
        const out = resolveInternalLinks(html, lookup);
        expect(out).toContain('class="broken-internal-link"');
        expect(out).toContain('Nonexistent');
    });

    it('leaves text inside tag attributes untouched', () => {
        const html = '<a href="https://x.com/[[fake]]">click</a>';
        const out = resolveInternalLinks(html, lookup);
        expect(out).toBe(html);
    });

    it('handles multiple links in one string', () => {
        const html = '<p>[[My Day]] and [[project plan]]</p>';
        const out = resolveInternalLinks(html, lookup);
        expect(out.match(/<a /g)?.length).toBe(2);
    });
});

describe('extractLinkTargets', () => {
    it('returns array of every [[X]] target in the HTML text', () => {
        const html = '<p>[[a]] and [[b]] and [[a]]</p>';
        const targets = extractLinkTargets(html);
        expect(targets).toEqual(['a', 'b', 'a']);
    });

    it('skips brackets inside attribute strings', () => {
        const html = '<a href="x://[[fake]]">x</a>';
        expect(extractLinkTargets(html)).toEqual([]);
    });
});
