/**
 * Feature: Entry duplication
 *  - duplicateEntry(dbm, userId, entryId) clones entry + content as a new Entry.
 *  - New entry has: distinct EntryID, title prefixed "Copy of ", current CreatedDate,
 *    same content/icon/tags/mood/parent, NOT pinned, NOT favorited, version 1.
 *  - Refuses cross-user duplication.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { duplicateEntry } from '../../src/lib/duplicate';

const TEST_DB_PATH = join(process.cwd(), `test-dup-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'd');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'D', 'Notebook');
    categoryId = r.lastInsertRowid;
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare(`DELETE FROM Entry WHERE CategoryID = ?`).run(categoryId);
});

describe('duplicateEntry', () => {
    it('clones an entry with prefixed title + same content', async () => {
        const src = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, Icon, Tags, Mood, IsFavorited, IsPinned)
             VALUES (?, 'Original', 'preview', '📝', '["work"]', 'happy', 1, 1)`
        ).run(categoryId);
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(src.lastInsertRowid, '<p>body</p>');

        const newId = await duplicateEntry(dbm, USER_ID, src.lastInsertRowid as number);

        expect(newId).toBeGreaterThan(0);
        expect(newId).not.toBe(src.lastInsertRowid);

        const clone = await dbm.prepare(`
            SELECT Title, Icon, Tags, Mood, IsFavorited, IsPinned, Version FROM Entry WHERE EntryID = ?
        `).get(newId) as any;
        expect(clone.Title).toBe('Copy of Original');
        expect(clone.Icon).toBe('📝');
        expect(JSON.parse(clone.Tags)).toEqual(['work']);
        expect(clone.Mood).toBe('happy');
        // Volatile flags reset on clone
        expect(clone.IsFavorited).toBe(0);
        expect(clone.IsPinned).toBe(0);
        expect(clone.Version).toBe(1);

        const cloneContent = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(newId) as any;
        expect(cloneContent.HtmlContent).toBe('<p>body</p>');
    });

    it('preserves ParentEntryID so clones land in the same folder', async () => {
        const parent = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, EntryType) VALUES (?, 'P', '', 'Folder')`
        ).run(categoryId);
        const src = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, ParentEntryID) VALUES (?, 'Child', '', ?)`
        ).run(categoryId, parent.lastInsertRowid);
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(src.lastInsertRowid, '');

        const newId = await duplicateEntry(dbm, USER_ID, src.lastInsertRowid as number);
        const clone = await dbm.prepare('SELECT ParentEntryID FROM Entry WHERE EntryID = ?').get(newId) as any;
        expect(clone.ParentEntryID).toBe(parent.lastInsertRowid);
    });

    it('cloned entry has a fresh CreatedDate (after original)', async () => {
        const src = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate) VALUES (?, 'old', '', '2020-01-01 00:00:00')`
        ).run(categoryId);
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(src.lastInsertRowid, '');

        const newId = await duplicateEntry(dbm, USER_ID, src.lastInsertRowid as number);
        const clone = await dbm.prepare('SELECT CreatedDate FROM Entry WHERE EntryID = ?').get(newId) as any;
        expect(clone.CreatedDate > '2020-01-01').toBe(true);
    });

    it('refuses to duplicate an entry owned by another user', async () => {
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'attacker');
        const otherCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(99, 'OC', 'Notebook');
        const victim = await dbm.prepare(`INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, 'private', '')`).run(otherCat.lastInsertRowid);

        await expect(duplicateEntry(dbm, USER_ID, victim.lastInsertRowid as number)).rejects.toThrow();
    });

    it('refuses to duplicate a soft-deleted entry', async () => {
        const src = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, IsDeleted) VALUES (?, 'gone', '', 1)`
        ).run(categoryId);
        await expect(duplicateEntry(dbm, USER_ID, src.lastInsertRowid as number)).rejects.toThrow();
    });
});
