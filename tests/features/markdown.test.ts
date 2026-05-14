/**
 * Feature: HTML → Markdown export
 *  - htmlToMarkdown(html) converts TipTap-generated HTML to portable Markdown
 *  - frontmatter(entry) emits YAML for title, created, modified, tags, mood
 *  - exportEntry(entry, content) returns full Markdown document
 *  - exportCategory(entries) returns concatenated bundle with frontmatter per entry
 */
import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, frontmatter, exportEntry, exportCategory } from '../../src/lib/markdown';

describe('htmlToMarkdown — block elements', () => {
    it('converts headings', () => {
        expect(htmlToMarkdown('<h1>Hello</h1>')).toBe('# Hello\n');
        expect(htmlToMarkdown('<h2>Sub</h2>')).toBe('## Sub\n');
        expect(htmlToMarkdown('<h3>Deep</h3>')).toBe('### Deep\n');
    });

    it('converts paragraphs', () => {
        expect(htmlToMarkdown('<p>One</p><p>Two</p>')).toBe('One\n\nTwo\n');
    });

    it('converts blockquotes', () => {
        const md = htmlToMarkdown('<blockquote><p>quoted</p></blockquote>');
        expect(md).toContain('> quoted');
    });

    it('converts horizontal rules', () => {
        expect(htmlToMarkdown('<hr/>')).toContain('---');
    });

    it('converts code blocks', () => {
        const md = htmlToMarkdown('<pre><code>let x = 1;</code></pre>');
        expect(md).toContain('```');
        expect(md).toContain('let x = 1;');
    });

    it('converts unordered lists', () => {
        const md = htmlToMarkdown('<ul><li>one</li><li>two</li></ul>');
        expect(md).toContain('- one');
        expect(md).toContain('- two');
    });

    it('converts ordered lists', () => {
        const md = htmlToMarkdown('<ol><li>first</li><li>second</li></ol>');
        expect(md).toContain('1. first');
        expect(md).toContain('2. second');
    });
});

describe('htmlToMarkdown — inline', () => {
    it('converts bold + italic', () => {
        expect(htmlToMarkdown('<p><strong>bold</strong> <em>italic</em></p>')).toContain('**bold**');
        expect(htmlToMarkdown('<p><strong>bold</strong> <em>italic</em></p>')).toContain('*italic*');
    });

    it('converts inline code', () => {
        expect(htmlToMarkdown('<p><code>x</code></p>')).toContain('`x`');
    });

    it('converts links', () => {
        expect(htmlToMarkdown('<p><a href="https://x.com">x</a></p>')).toContain('[x](https://x.com)');
    });

    it('converts images', () => {
        expect(htmlToMarkdown('<p><img src="/img.png" alt="alt"/></p>')).toContain('![alt](/img.png)');
    });
});

describe('frontmatter', () => {
    it('emits YAML with provided fields', () => {
        const fm = frontmatter({
            title: 'My Day',
            createdDate: '2024-05-13 12:00:00',
            modifiedDate: '2024-05-14 09:00:00',
            tags: ['work', 'travel'],
            mood: 'happy',
        });
        expect(fm).toContain('---');
        expect(fm).toContain('title: My Day');
        expect(fm).toContain('created: 2024-05-13 12:00:00');
        expect(fm).toContain('mood: happy');
        expect(fm).toContain('tags: [work, travel]');
    });

    it('escapes quotes in title', () => {
        const fm = frontmatter({ title: 'has "quotes"', tags: [] });
        expect(fm).toContain('title: "has \\"quotes\\""');
    });
});

describe('exportEntry / exportCategory', () => {
    it('exportEntry combines frontmatter + markdown body', () => {
        const out = exportEntry(
            { title: 'T', createdDate: '2024-01-01', tags: [] },
            '<p>Hello world</p>'
        );
        expect(out.startsWith('---')).toBe(true);
        expect(out).toContain('Hello world');
    });

    it('exportCategory bundles entries with separators', () => {
        const out = exportCategory([
            { entry: { title: 'A', createdDate: '2024-01-01', tags: [] }, html: '<p>aa</p>' },
            { entry: { title: 'B', createdDate: '2024-01-02', tags: [] }, html: '<p>bb</p>' },
        ]);
        expect(out).toContain('title: A');
        expect(out).toContain('title: B');
        expect(out).toContain('aa');
        expect(out).toContain('bb');
        // Each entry should have its own frontmatter block
        expect(out.match(/^---$/gm)?.length).toBeGreaterThanOrEqual(4);
    });
});
