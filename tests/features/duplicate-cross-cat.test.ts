/**
 * Duplicate entry across categories.
 *  - duplicateEntry(_, _, _, targetCategoryId) copies the entry into another category
 *  - ParentEntryID is reset (parent might not exist in the new category)
 *  - Target category ownership is verified — foreign target throws
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { duplicateEntry } from '../../src/lib/duplicate';

const TEST_DB_PATH = join(process.cwd(), `test-dup-cc-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let catA: number, catB: number, otherCat: number;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'd');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'other');
    const a = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'A', 'Notebook');
    catA = a.lastInsertRowid;
    const b = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'B', 'Notebook');
    catB = b.lastInsertRowid;
    const o = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(99, 'O', 'Notebook');
    otherCat = o.lastInsertRowid;
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare(`DELETE FROM Entry`).run();
});

describe('duplicateEntry — cross-category', () => {
    it('duplicates into a different owned category', async () => {
        const src = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, 'src', '')`
        ).run(catA);
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(src.lastInsertRowid, '<p>body</p>');

        const newId = await duplicateEntry(dbm, USER_ID, src.lastInsertRowid as number, catB);
        const clone = await dbm.prepare('SELECT CategoryID, Title FROM Entry WHERE EntryID = ?').get(newId) as any;
        expect(clone.CategoryID).toBe(catB);
        expect(clone.Title).toBe('Copy of src');
    });

    it('resets ParentEntryID when crossing categories', async () => {
        const parent = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, EntryType) VALUES (?, 'p', '', 'Folder')`
        ).run(catA);
        const child = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, ParentEntryID) VALUES (?, 'c', '', ?)`
        ).run(catA, parent.lastInsertRowid);
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(child.lastInsertRowid, '');

        const newId = await duplicateEntry(dbm, USER_ID, child.lastInsertRowid as number, catB);
        const clone = await dbm.prepare('SELECT ParentEntryID FROM Entry WHERE EntryID = ?').get(newId) as any;
        expect(clone.ParentEntryID).toBeNull();
    });

    it('refuses target category owned by another user', async () => {
        const src = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, 'x', '')`
        ).run(catA);
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(src.lastInsertRowid, '');
        await expect(duplicateEntry(dbm, USER_ID, src.lastInsertRowid as number, otherCat)).rejects.toThrow();
    });

    it('defaults to source category when targetCategoryId is undefined', async () => {
        const src = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, 'x', '')`
        ).run(catA);
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(src.lastInsertRowid, '');
        const newId = await duplicateEntry(dbm, USER_ID, src.lastInsertRowid as number);
        const clone = await dbm.prepare('SELECT CategoryID FROM Entry WHERE EntryID = ?').get(newId) as any;
        expect(clone.CategoryID).toBe(catA);
    });
});
