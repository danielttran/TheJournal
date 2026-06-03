import { describe, it, expect } from 'vitest';
import {
    normalizeInlineTagName, normalizeTagColor, extractInlineTags,
} from '../../src/lib/inlineTag';

describe('normalizeInlineTagName', () => {
    it('trims and collapses whitespace', () => {
        expect(normalizeInlineTagName('  work   stuff  ')).toBe('work stuff');
    });
    it('clamps to 60 chars', () => {
        expect(normalizeInlineTagName('x'.repeat(80)).length).toBe(60);
    });
    it('returns empty for blank input', () => {
        expect(normalizeInlineTagName('   ')).toBe('');
        expect(normalizeInlineTagName('')).toBe('');
    });
});

describe('normalizeTagColor', () => {
    it('keeps valid hex', () => {
        expect(normalizeTagColor('#fff')).toBe('#fff');
        expect(normalizeTagColor('#a1b2c3')).toBe('#a1b2c3');
    });
    it('falls back for invalid/missing', () => {
        expect(normalizeTagColor(null)).toBe('#888888');
        expect(normalizeTagColor('red')).toBe('#888888');
        expect(normalizeTagColor(undefined)).toBe('#888888');
    });
});

describe('extractInlineTags', () => {
    it('returns [] for empty/no tags', () => {
        expect(extractInlineTags('')).toEqual([]);
        expect(extractInlineTags('<p>no tags here</p>')).toEqual([]);
    });

    it('extracts a tag with its color', () => {
        const html = '<p>see <span data-tag="Work" data-tag-color="#ff0000">this</span></p>';
        expect(extractInlineTags(html)).toEqual([{ name: 'Work', color: '#ff0000' }]);
    });

    it('dedupes by case-insensitive name, first spelling wins', () => {
        const html = '<span data-tag="Idea">a</span> <span data-tag="idea">b</span>';
        expect(extractInlineTags(html)).toEqual([{ name: 'Idea', color: '#888888' }]);
    });

    it('decodes HTML entities in the name', () => {
        const html = '<span data-tag="R&amp;D">x</span>';
        expect(extractInlineTags(html)).toEqual([{ name: 'R&D', color: '#888888' }]);
    });

    it('defaults the color when none/invalid is present', () => {
        const html = '<span data-tag="Travel" data-tag-color="bogus">x</span>';
        expect(extractInlineTags(html)).toEqual([{ name: 'Travel', color: '#888888' }]);
    });

    it('extracts multiple distinct tags in first-seen order', () => {
        const html = '<span data-tag="B">b</span><span data-tag="A">a</span>';
        expect(extractInlineTags(html).map(t => t.name)).toEqual(['B', 'A']);
    });
});
