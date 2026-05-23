import { describe, it, expect } from 'vitest';
import { parseImport, rtfToPlainText, sanitizeImportedHtml, formatFromFilename } from '../../src/lib/importEntries';

describe('parseImport — TXT', () => {
    it('uses the first line as title and splits paragraphs on blank lines', () => {
        const r = parseImport('My Day\n\nIt was good.\nReally good.', 'txt', 'Untitled');
        expect(r.title).toBe('My Day');
        expect(r.html).toContain('<p>My Day</p>');
        expect(r.html).toContain('<p>It was good.<br>Really good.</p>');
    });

    it('escapes HTML-special characters', () => {
        const r = parseImport('a < b & c', 'txt', 'Untitled');
        expect(r.html).toContain('a &lt; b &amp; c');
        expect(r.html).not.toContain('<b ');
    });

    it('falls back to the given title when empty', () => {
        const r = parseImport('   ', 'txt', 'Imported');
        expect(r.title).toBe('Imported');
        expect(r.html).toBe('<p></p>');
    });
});

describe('parseImport — HTML', () => {
    it('extracts the <title> and body, stripping scripts', () => {
        const html = '<html><head><title>Hello</title></head><body><p>Hi</p><script>alert(1)</script></body></html>';
        const r = parseImport(html, 'html', 'Untitled');
        expect(r.title).toBe('Hello');
        expect(r.html).toContain('<p>Hi</p>');
        expect(r.html).not.toContain('alert(1)');
    });

    it('falls back to the first <h1> when there is no title', () => {
        const r = parseImport('<body><h1>Heading</h1><p>x</p></body>', 'html', 'Untitled');
        expect(r.title).toBe('Heading');
    });
});

describe('sanitizeImportedHtml', () => {
    it('removes scripts, styles, inline handlers, and javascript: URLs', () => {
        const dirty = `<p onclick="evil()">x</p><style>p{}</style><a href="javascript:alert(1)">y</a>`;
        const clean = sanitizeImportedHtml(dirty);
        expect(clean).not.toContain('onclick');
        expect(clean).not.toContain('<style');
        expect(clean).not.toContain('javascript:');
        expect(clean).toContain('x');
    });
});

describe('rtfToPlainText', () => {
    it('extracts prose, drops the font table, and honours \\par', () => {
        const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0\fs24 Hello world.\par Second line.}`;
        const text = rtfToPlainText(rtf);
        expect(text).toContain('Hello world.');
        expect(text).toContain('Second line.');
        expect(text).not.toContain('Arial');
        expect(text.split('\n').length).toBeGreaterThanOrEqual(2);
    });

    it('decodes hex escapes', () => {
        const rtf = String.raw`{\rtf1 caf\'e9}`;
        expect(rtfToPlainText(rtf)).toContain('café');
    });

    it('produces paragraphs through parseImport', () => {
        const rtf = String.raw`{\rtf1 Title line\par Body text here.}`;
        const r = parseImport(rtf, 'rtf', 'Untitled');
        expect(r.title).toBe('Title line');
        expect(r.html).toContain('<p>Body text here.</p>');
    });
});

describe('formatFromFilename', () => {
    it('maps known extensions', () => {
        expect(formatFromFilename('a.txt')).toBe('txt');
        expect(formatFromFilename('a.HTML')).toBe('html');
        expect(formatFromFilename('a.rtf')).toBe('rtf');
        expect(formatFromFilename('a.pdf')).toBeNull();
    });
});
