/**
 * Snippet shortcut auto-expansion matcher. Drives the editor's inline expansion
 * (type ";sig" + space → snippet content). Pure so we can exercise the boundary
 * and longest-match rules without an editor.
 */
import { describe, it, expect } from 'vitest';
import { matchSnippetShortcut } from '../../src/lib/snippetExpand';

const snippets = [
    { shortcut: ';sig', content: '<p>Cheers, me</p>' },
    { shortcut: ';s', content: 'short' },
    { shortcut: ';addr', content: '123 Main St' },
    { shortcut: null, content: 'no shortcut' },
];

describe('matchSnippetShortcut', () => {
    it('matches a shortcut at the start of the block', () => {
        const m = matchSnippetShortcut(';sig', snippets);
        expect(m).toMatchObject({ shortcut: ';sig', content: '<p>Cheers, me</p>', start: 0 });
    });

    it('matches a shortcut preceded by whitespace', () => {
        const m = matchSnippetShortcut('hello ;addr', snippets);
        expect(m).toMatchObject({ shortcut: ';addr', start: 6 });
    });

    it('prefers the LONGEST matching shortcut (;sig over ;s)', () => {
        const m = matchSnippetShortcut('here ;sig', snippets);
        expect(m?.shortcut).toBe(';sig');
    });

    it('does NOT expand mid-word (no whitespace boundary)', () => {
        expect(matchSnippetShortcut('design;addr', [{ shortcut: 'addr', content: 'x' }])).toBeNull();
    });

    it('returns null when nothing matches', () => {
        expect(matchSnippetShortcut('just typing', snippets)).toBeNull();
        expect(matchSnippetShortcut('', snippets)).toBeNull();
    });

    it('ignores snippets without a shortcut', () => {
        expect(matchSnippetShortcut('no shortcut', snippets)).toBeNull();
    });
});
