/**
 * Feature: Bulk entry operations
 *  - bulkSoftDelete / bulkRestore / bulkPermDelete / bulkAddTag / bulkRemoveTag
 *  - All operate atomically inside a transaction
 *  - All scope to userId (ownership filter)
 *  - Mixed-ownership input: silently skip the non-owned entries (return count of actual changes)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { bulkSoftDelete, bulkRestore, bulkPermanentDelete, bulkAddTag, bulkRemoveTag } from '../../src/lib/bulk';

const TEST_DB_PATH = join(process.cwd(), `test-bulk-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function entry(title: string, tags: string[] = []): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, Tags) VALUES (?, ?, ?, ?)`
    ).run(categoryId, title, '', JSON.stringify(tags));
    await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(r.lastInsertRowid, '');
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'b');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'other');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'B', 'Notebook');
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

describe('bulkSoftDelete', () => {
    it('soft-deletes a set of entries owned by the user', async () => {
        const a = await entry('a');
        const b = await entry('b');
        const c = await entry('c');
        const result = await bulkSoftDelete(dbm, USER_ID, [a, b]);
        expect(result.changed).toBe(2);

        const all = await dbm.prepare(
            `SELECT EntryID, IsDeleted FROM Entry WHERE EntryID IN (?, ?, ?)`
        ).all(a, b, c) as { EntryID: number; IsDeleted: number }[];
        const map = new Map(all.map(r => [r.EntryID, r.IsDeleted]));
        expect(map.get(a)).toBe(1);
        expect(map.get(b)).toBe(1);
        expect(map.get(c)).toBe(0);
    });

    it('silently skips entries owned by another user', async () => {
        const mine = await entry('mine');
        const otherCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(99, 'oc', 'Notebook');
        const theirs = await dbm.prepare(`INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`).run(otherCat.lastInsertRowid, 'theirs', '');

        const result = await bulkSoftDelete(dbm, USER_ID, [mine, theirs.lastInsertRowid as number]);
        expect(result.changed).toBe(1);

        const t = await dbm.prepare('SELECT IsDeleted FROM Entry WHERE EntryID = ?').get(theirs.lastInsertRowid) as { IsDeleted: number };
        expect(t.IsDeleted).toBe(0); // their entry still alive
    });

    it('returns changed=0 for empty input', async () => {
        const result = await bulkSoftDelete(dbm, USER_ID, []);
        expect(result.changed).toBe(0);
    });
});

describe('bulkRestore', () => {
    it('restores soft-deleted entries', async () => {
        const a = await entry('a');
        await dbm.prepare(`UPDATE Entry SET IsDeleted = 1 WHERE EntryID = ?`).run(a);
        const r = await bulkRestore(dbm, USER_ID, [a]);
        expect(r.changed).toBe(1);
        const row = await dbm.prepare('SELECT IsDeleted FROM Entry WHERE EntryID = ?').get(a) as { IsDeleted: number };
        expect(row.IsDeleted).toBe(0);
    });
});

describe('bulkPermanentDelete', () => {
    it('physically removes entries + their content', async () => {
        const a = await entry('a');
        const b = await entry('b');
        await bulkPermanentDelete(dbm, USER_ID, [a, b]);
        const surviving = await dbm.prepare('SELECT EntryID FROM Entry WHERE EntryID IN (?, ?)').all(a, b) as any[];
        expect(surviving.length).toBe(0);
        const orphans = await dbm.prepare('SELECT EntryID FROM EntryContent WHERE EntryID IN (?, ?)').all(a, b) as any[];
        expect(orphans.length).toBe(0);
    });
});

describe('bulkAddTag / bulkRemoveTag', () => {
    it('adds a tag to every entry that doesn\'t already have it', async () => {
        const a = await entry('a', ['existing']);
        const b = await entry('b', []);

        const r = await bulkAddTag(dbm, USER_ID, [a, b], 'work');
        expect(r.changed).toBe(2);

        const rowA = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(a) as { Tags: string };
        const rowB = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(b) as { Tags: string };
        expect(JSON.parse(rowA.Tags).sort()).toEqual(['existing', 'work']);
        expect(JSON.parse(rowB.Tags)).toEqual(['work']);
    });

    it('does not duplicate a tag already present', async () => {
        const a = await entry('a', ['work']);
        await bulkAddTag(dbm, USER_ID, [a], 'work');
        const row = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(a) as { Tags: string };
        expect(JSON.parse(row.Tags)).toEqual(['work']);
    });

    it('removes a tag from every selected entry', async () => {
        const a = await entry('a', ['work', 'travel']);
        const b = await entry('b', ['work']);
        await bulkRemoveTag(dbm, USER_ID, [a, b], 'work');
        const rowA = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(a) as { Tags: string };
        const rowB = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(b) as { Tags: string };
        expect(JSON.parse(rowA.Tags)).toEqual(['travel']);
        expect(JSON.parse(rowB.Tags)).toEqual([]);
    });

    it('normalizes tag (lowercase, trim) on add', async () => {
        const a = await entry('a');
        await bulkAddTag(dbm, USER_ID, [a], '  WORK  ');
        const row = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(a) as { Tags: string };
        expect(JSON.parse(row.Tags)).toEqual(['work']);
    });
});
