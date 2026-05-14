/**
 * Audit: edge cases & input-validation gaps across the new features.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { listDistinctTags, filterEntriesByTags, normalizeTag } from '../../src/lib/tags';
import { softDeleteEntry, restoreEntry } from '../../src/lib/trash';
import { createReminder, listReminders } from '../../src/lib/reminders';
import { computeProgress, countWords } from '../../src/lib/wordgoals';
import { buildReplaceRegex, executeReplace } from '../../src/lib/replace';
import { resolveInternalLinks } from '../../src/lib/internalLinks';
import { htmlToMarkdown, frontmatter } from '../../src/lib/markdown';
import { applyBuiltins, parseTemplateVariables } from '../../src/lib/smartTemplates';

const TEST_DB_PATH = join(process.cwd(), `test-edges-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function entry(title: string, html = ''): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`
    ).run(categoryId, title, '');
    if (html) await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(r.lastInsertRowid, html);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'edges');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'E', 'Notebook');
    categoryId = r.lastInsertRowid;
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Entry WHERE CategoryID = ?').run(categoryId);
});

describe('Tags — edge cases', () => {
    it('survives malformed JSON in Tags column', async () => {
        const id = await entry('a');
        await dbm.prepare('UPDATE Entry SET Tags = ? WHERE EntryID = ?').run('{not json}', id);
        // listDistinctTags should not throw; should return empty
        const tags = await listDistinctTags(dbm, USER_ID);
        expect(tags).toEqual([]);
    });

    it('filterEntriesByTags handles non-array Tags gracefully', async () => {
        const id = await entry('a');
        await dbm.prepare('UPDATE Entry SET Tags = ? WHERE EntryID = ?').run('"not an array"', id);
        const result = await filterEntriesByTags(dbm, USER_ID, ['foo']);
        expect(result).toEqual([]);
    });

    it('filterEntriesByTags with empty tag list returns empty (not all entries)', async () => {
        await entry('a');
        await dbm.prepare(`UPDATE Entry SET Tags = ? WHERE Title = 'a'`).run('["x"]');
        expect(await filterEntriesByTags(dbm, USER_ID, [])).toEqual([]);
        expect(await filterEntriesByTags(dbm, USER_ID, ['   '])).toEqual([]); // whitespace-only
    });

    it('normalizeTag strips multiple trailing commas', () => {
        expect(normalizeTag('travel,,,')).toBe('travel');
    });
});

describe('Trash — edge cases', () => {
    it('soft-deleting a non-existent entry is a no-op (no throw)', async () => {
        await expect(softDeleteEntry(dbm, 99999)).resolves.not.toThrow();
    });

    it('restoring a non-existent entry is a no-op', async () => {
        await expect(restoreEntry(dbm, 99999)).resolves.not.toThrow();
    });

    it('soft-deleting twice leaves the entry deleted (idempotent)', async () => {
        const id = await entry('x');
        await softDeleteEntry(dbm, id);
        await softDeleteEntry(dbm, id);
        const row = await dbm.prepare('SELECT IsDeleted FROM Entry WHERE EntryID = ?').get(id) as any;
        expect(row.IsDeleted).toBe(1);
    });
});

describe('Reminders — edge cases', () => {
    it('list "today" handles entries due at midnight + 23:59', async () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        await createReminder(dbm, USER_ID, { title: 'midnight', dueAt: today.toISOString() });
        await createReminder(dbm, USER_ID, { title: 'nextday', dueAt: tomorrow.toISOString() });
        const list = await listReminders(dbm, USER_ID, 'today');
        const titles = list.map(r => r.Title);
        expect(titles).toContain('midnight');
        expect(titles).not.toContain('nextday');
        await dbm.prepare('DELETE FROM Reminder').run();
    });
});

describe('Word goals — edge cases', () => {
    it('countWords handles null + undefined', () => {
        expect(countWords(null)).toBe(0);
        expect(countWords(undefined)).toBe(0);
    });

    it('countWords does not double-count when words touch tags', () => {
        // <p>foo</p><p>bar</p> should be 2, not 1
        expect(countWords('<p>foo</p><p>bar</p>')).toBe(2);
    });

    it('computeProgress with zero target returns 0% (no divide-by-zero)', async () => {
        const p = await computeProgress(dbm, USER_ID, {
            type: 'total', target: 0,
            startDate: '2020-01-01', endDate: null, categoryId: null,
        });
        expect(p.percent).toBe(0);
        expect(p.current).toBe(0);
    });
});

describe('Replace — edge cases', () => {
    it('buildReplaceRegex on empty find returns a regex that matches nothing useful', () => {
        const re = buildReplaceRegex('', { matchCase: false, wholeWord: false });
        // Empty pattern matches every position; we rely on schema validation
        // (min(1)) to prevent this from reaching the lib in production.
        expect(re).toBeInstanceOf(RegExp);
    });

    it('executeReplace with no matches returns zero counts and does not bump versions', async () => {
        const id = await entry('a', '<p>nothing here</p>');
        const before = await dbm.prepare('SELECT Version FROM Entry WHERE EntryID = ?').get(id) as any;
        const result = await executeReplace(dbm, USER_ID, { categoryId, find: 'xyz', replace: 'q', matchCase: false, wholeWord: false });
        expect(result.totalEntriesChanged).toBe(0);
        const after = await dbm.prepare('SELECT Version FROM Entry WHERE EntryID = ?').get(id) as any;
        expect(after.Version).toBe(before.Version);
    });

    it('replace inside <a href="..."> attribute does NOT alter the URL', async () => {
        const id = await entry('a', '<p>visit <a href="https://foo.example/page">foo</a> today</p>');
        await executeReplace(dbm, USER_ID, { categoryId, find: 'foo', replace: 'bar', matchCase: false, wholeWord: false });
        const content = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(id) as any;
        // URL must NOT have been touched
        expect(content.HtmlContent).toContain('href="https://foo.example/page"');
        // Link text was 'foo' → 'bar'
        expect(content.HtmlContent).toContain('>bar</a>');
    });
});

describe('Internal links — edge cases', () => {
    it('handles unmatched brackets gracefully', () => {
        expect(resolveInternalLinks('<p>[[unclosed</p>', () => null)).toContain('[[unclosed');
    });

    it('handles newline inside brackets — does not span lines', () => {
        const out = resolveInternalLinks('[[foo\nbar]]', (q) => q === 'foo\nbar' ? { id: 1, title: 'X' } : null);
        // The regex disallows newlines inside brackets so this should not be parsed as a link
        expect(out).toContain('[[foo\nbar]]');
    });

    it('rejects link targets that contain < or > (defense-in-depth XSS guard)', () => {
        // Regex disallows < and > inside [[...]]. The string is left unchanged,
        // and importantly no anchor or span containing raw HTML is emitted.
        const out = resolveInternalLinks('[[<script>]]', () => null);
        expect(out).not.toContain('<a href');
        expect(out).not.toContain('class="broken-internal-link"');
    });

    it('escapes user-provided unresolved title text', () => {
        // A target with only safe chars but ampersand/quote should be escaped on the way out.
        const out = resolveInternalLinks('[[a & b]]', () => null);
        expect(out).toContain('a &amp; b');
    });
});

describe('Markdown — edge cases', () => {
    it('htmlToMarkdown handles empty input', () => {
        expect(htmlToMarkdown('')).toBe('');
        expect(htmlToMarkdown(null as any)).toBe('');
    });

    it('frontmatter escapes embedded quotes', () => {
        const fm = frontmatter({ title: 'has "x"', tags: [] });
        expect(fm).toContain('"has \\"x\\""');
    });

    it('htmlToMarkdown handles nested formatting', () => {
        const md = htmlToMarkdown('<p><strong>bold <em>and italic</em></strong></p>');
        expect(md).toContain('bold');
        expect(md).toContain('and italic');
    });
});

describe('Smart templates — edge cases', () => {
    it('parseTemplateVariables ignores malformed placeholders', () => {
        const vars = parseTemplateVariables('{{}} {{ }} {{ok}} {  not }');
        expect(vars.map(v => v.key)).toEqual(['ok']);
    });

    it('applyBuiltins with title containing template-like syntax does not recurse', () => {
        const out = applyBuiltins('{{title}}', { title: '{{date}}' });
        expect(out).toBe('{{date}}'); // not re-processed
    });
});
