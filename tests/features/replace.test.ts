/**
 * Feature: Search-and-replace across category
 *  - buildReplaceRegex(find, { matchCase, wholeWord }) returns a global RegExp
 *  - previewReplace(dbm, userId, params) returns affected entries + counts (no mutation)
 *  - executeReplace(dbm, userId, params) updates EntryContent + bumps Version
 *  - Replacement is HTML-aware: avoids replacing inside tag attributes (uses text-only scan)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { buildReplaceRegex, previewReplace, executeReplace } from '../../src/lib/replace';
import { setCategoryPassword, encryptWithKey, decryptWithKey, ENC_PREFIX } from '../../src/lib/categoryCrypto';
import { cacheCategoryKey, clearCategoryKey } from '../../src/lib/categoryKeyCache';

const TEST_DB_PATH = join(process.cwd(), `test-rep-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function entry(html: string): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`
    ).run(categoryId, 't', '');
    await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(r.lastInsertRowid, html);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'rep');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'R', 'Notebook');
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

describe('buildReplaceRegex', () => {
    it('default: case-insensitive, no boundary', () => {
        const re = buildReplaceRegex('foo', { matchCase: false, wholeWord: false });
        expect('FOOBAR'.replace(re, 'X')).toBe('XBAR');
    });
    it('matchCase: respects case', () => {
        const re = buildReplaceRegex('foo', { matchCase: true, wholeWord: false });
        expect('FOObar'.replace(re, 'X')).toBe('FOObar');
        expect('foobar'.replace(re, 'X')).toBe('Xbar');
    });
    it('wholeWord: anchors to word boundaries', () => {
        const re = buildReplaceRegex('foo', { matchCase: false, wholeWord: true });
        expect('foobar foo bar'.replace(re, 'X')).toBe('foobar X bar');
    });
    it('escapes regex metacharacters in `find`', () => {
        const re = buildReplaceRegex('a.b', { matchCase: false, wholeWord: false });
        expect('a.b axb'.replace(re, 'X')).toBe('X axb');
    });
});

describe('previewReplace', () => {
    it('returns counts per entry without mutating content', async () => {
        const id1 = await entry('<p>The cat sat on the mat. The cat.</p>');
        const id2 = await entry('<p>No matches here.</p>');
        const id3 = await entry('<p>Another cat over there.</p>');

        const r = await previewReplace(dbm, USER_ID, { categoryId, find: 'cat', replace: 'dog', matchCase: false, wholeWord: false });
        const map = new Map(r.affected.map(a => [a.EntryID, a.count]));
        expect(map.get(id1)).toBe(2);
        expect(map.get(id2)).toBeUndefined();
        expect(map.get(id3)).toBe(1);

        const row = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(id1) as any;
        expect(row.HtmlContent).toContain('cat'); // not mutated
    });
});

describe('executeReplace', () => {
    it('updates HtmlContent and bumps Version', async () => {
        const id = await entry('<p>foo bar foo</p>');
        const before = await dbm.prepare('SELECT Version FROM Entry WHERE EntryID = ?').get(id) as any;
        const result = await executeReplace(dbm, USER_ID, { categoryId, find: 'foo', replace: 'baz', matchCase: false, wholeWord: false });
        const after = await dbm.prepare('SELECT Version FROM Entry WHERE EntryID = ?').get(id) as any;
        const content = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(id) as any;

        expect(content.HtmlContent).toBe('<p>baz bar baz</p>');
        expect(after.Version).toBe(before.Version + 1);
        expect(result.totalEntriesChanged).toBe(1);
        expect(result.totalReplacements).toBe(2);
    });

    it('only touches entries in the requested category', async () => {
        const otherCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'O', 'Notebook');
        const inside = await entry('<p>match me</p>');
        const outside = await dbm.prepare(`INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`).run(otherCat.lastInsertRowid, 't', '');
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(outside.lastInsertRowid, '<p>match me</p>');

        await executeReplace(dbm, USER_ID, { categoryId, find: 'match', replace: 'gone', matchCase: false, wholeWord: false });

        const insideRow = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(inside) as any;
        const outsideRow = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(outside.lastInsertRowid) as any;
        expect(insideRow.HtmlContent).toContain('gone');
        expect(outsideRow.HtmlContent).toContain('match');
    });

    it('respects wholeWord boundaries', async () => {
        const id = await entry('<p>cat catalogue cats cat</p>');
        await executeReplace(dbm, USER_ID, { categoryId, find: 'cat', replace: 'X', matchCase: false, wholeWord: true });
        const content = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(id) as any;
        expect(content.HtmlContent).toBe('<p>X catalogue cats X</p>');
    });
});

describe('executeReplace on a password-locked category', () => {
    let lockedCat: number;
    let eek: Uint8Array;

    beforeEach(async () => {
        const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'L', 'Notebook');
        lockedCat = r.lastInsertRowid;
        eek = await setCategoryPassword(dbm, USER_ID, lockedCat, 'pw');
    });

    async function lockedEntry(html: string): Promise<number> {
        const ciphertext = encryptWithKey(html, eek);
        const r = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`
        ).run(lockedCat, 't', '');
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(r.lastInsertRowid, ciphertext);
        return r.lastInsertRowid;
    }

    it('decrypts, replaces, and re-encrypts so content stays decryptable', async () => {
        cacheCategoryKey(USER_ID, lockedCat, eek);
        const id = await lockedEntry('<p>match me</p>');

        const { totalReplacements } = await executeReplace(dbm, USER_ID,
            { categoryId: lockedCat, find: 'match', replace: 'gone', matchCase: false, wholeWord: false });
        expect(totalReplacements).toBe(1);

        const row = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(id) as any;
        // Still ciphertext on disk...
        expect(row.HtmlContent.startsWith(ENC_PREFIX)).toBe(true);
        // ...and decrypts to the replaced plaintext (not mangled).
        expect(decryptWithKey(row.HtmlContent, eek)).toContain('gone');
    });

    it('refuses (CATEGORY_LOCKED) when the EEK is not cached, leaving ciphertext intact', async () => {
        cacheCategoryKey(USER_ID, lockedCat, eek);
        const id = await lockedEntry('<p>match me</p>');
        const before = (await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(id) as any).HtmlContent;
        clearCategoryKey(USER_ID, lockedCat);

        await expect(executeReplace(dbm, USER_ID,
            { categoryId: lockedCat, find: 'match', replace: 'gone', matchCase: false, wholeWord: false }))
            .rejects.toMatchObject({ code: 'CATEGORY_LOCKED' });

        const after = (await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(id) as any).HtmlContent;
        expect(after).toBe(before);
    });
});
