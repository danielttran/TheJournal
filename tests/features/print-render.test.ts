/**
 * Feature: renderEntryForPrint — David RM parity print/PDF export render.
 *  - Produces a complete <!DOCTYPE html> document.
 *  - Title and metadata are HTML-escaped (XSS-safe).
 *  - TipTap body passes through verbatim (already sanitised at the editor).
 *  - Missing fields are omitted cleanly.
 */
import { describe, it, expect } from 'vitest';
import { renderEntryForPrint } from '../../src/lib/printRender';

describe('renderEntryForPrint', () => {
    it('produces a complete HTML document', () => {
        const out = renderEntryForPrint({ title: 'My day', htmlContent: '<p>hello</p>' });
        expect(out).toMatch(/^<!DOCTYPE html>/);
        expect(out).toContain('<html');
        expect(out).toContain('<style>');
        expect(out).toContain('</html>');
    });

    it('renders the title in <h1> and <title>', () => {
        const out = renderEntryForPrint({ title: 'A Trip', htmlContent: '<p>x</p>' });
        expect(out).toContain('<title>A Trip</title>');
        expect(out).toMatch(/<h1>A Trip<\/h1>/);
    });

    it('falls back to "Untitled" for blank titles', () => {
        const out = renderEntryForPrint({ title: '   ', htmlContent: '<p>x</p>' });
        expect(out).toContain('<title>Untitled</title>');
        expect(out).toMatch(/<h1>Untitled<\/h1>/);
    });

    it('HTML-escapes the title and metadata fields', () => {
        const out = renderEntryForPrint({
            title: 'Risky <script>alert(1)</script>',
            htmlContent: '<p>x</p>',
            categoryName: 'A & B',
            author: '"Boss" <admin>',
            mood: '>:(',
        });
        expect(out).not.toMatch(/<script>alert\(1\)<\/script>/);
        expect(out).toContain('Risky &lt;script&gt;alert(1)&lt;/script&gt;');
        expect(out).toContain('A &amp; B');
        expect(out).toContain('&quot;Boss&quot; &lt;admin&gt;');
        expect(out).toContain('&gt;:(');
    });

    it('passes the TipTap body through verbatim', () => {
        const body = '<p>line one</p><table><tr><td>cell</td></tr></table>';
        const out = renderEntryForPrint({ title: 't', htmlContent: body });
        expect(out).toContain(body);
    });

    it('omits the meta block when no metadata is supplied', () => {
        const out = renderEntryForPrint({ title: 't', htmlContent: '<p>x</p>' });
        expect(out).not.toContain('class="meta"');
    });

    it('renders supplied metadata in the order Created, Modified, Journal, Author, Mood', () => {
        const out = renderEntryForPrint({
            title: 't',
            htmlContent: '<p>x</p>',
            createdDate: '2026-05-14 09:00',
            modifiedDate: '2026-05-15 10:00',
            categoryName: 'Daily',
            author: 'Sam',
            mood: 'happy',
        });
        const idxCreated  = out.indexOf('<strong>Created:</strong>');
        const idxModified = out.indexOf('<strong>Modified:</strong>');
        const idxJournal  = out.indexOf('<strong>Journal:</strong>');
        const idxAuthor   = out.indexOf('<strong>Author:</strong>');
        const idxMood     = out.indexOf('<strong>Mood:</strong>');
        expect(idxCreated).toBeGreaterThan(0);
        expect(idxModified).toBeGreaterThan(idxCreated);
        expect(idxJournal).toBeGreaterThan(idxModified);
        expect(idxAuthor).toBeGreaterThan(idxJournal);
        expect(idxMood).toBeGreaterThan(idxAuthor);
    });

    it('skips the Modified row when it equals Created', () => {
        const out = renderEntryForPrint({
            title: 't',
            htmlContent: '<p>x</p>',
            createdDate:  '2026-05-14 09:00',
            modifiedDate: '2026-05-14 09:00',
        });
        expect(out).toContain('<strong>Created:</strong>');
        expect(out).not.toContain('<strong>Modified:</strong>');
    });

    it('renders tags as a comma-separated list', () => {
        const out = renderEntryForPrint({
            title: 't', htmlContent: '<p>x</p>',
            tags: ['travel', 'food', 'family'],
        });
        expect(out).toContain('<div class="tags">travel, food, family</div>');
    });

    it('omits the tags block when tags are empty or undefined', () => {
        const a = renderEntryForPrint({ title: 't', htmlContent: '<p>x</p>' });
        const b = renderEntryForPrint({ title: 't', htmlContent: '<p>x</p>', tags: [] });
        expect(a).not.toContain('class="tags"');
        expect(b).not.toContain('class="tags"');
    });

    it('escapes tag entries (XSS safe)', () => {
        const out = renderEntryForPrint({
            title: 't', htmlContent: '<p>x</p>',
            tags: ['<script>x</script>'],
        });
        expect(out).not.toContain('<script>x</script>');
        expect(out).toContain('&lt;script&gt;x&lt;/script&gt;');
    });

    it('handles empty htmlContent gracefully', () => {
        const out = renderEntryForPrint({ title: 't', htmlContent: '' });
        expect(out).toContain('<article></article>');
    });

    it('handles undefined htmlContent gracefully', () => {
        // @ts-expect-error — defensive against null/undefined from older rows
        const out = renderEntryForPrint({ title: 't', htmlContent: undefined });
        expect(out).toContain('<article></article>');
    });
});
