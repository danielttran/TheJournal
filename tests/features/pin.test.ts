/**
 * Feature: Pinned entries
 *  - Entry has IsPinned BOOLEAN + PinnedDate DATETIME
 *  - pinEntry / unpinEntry helpers
 *  - listPinned(userId, categoryId?) returns pinned entries sorted by PinnedDate desc
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { pinEntry, unpinEntry, listPinned } from '../../src/lib/pin';

const TEST_DB_PATH = join(process.cwd(), `test-pin-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function entry(title: string): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`
    ).run(categoryId, title, '');
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'pin-user');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'P', 'Notebook');
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

describe('Pin — schema', () => {
    it('Entry has IsPinned and PinnedDate columns', async () => {
        const cols = await dbm.prepare(`PRAGMA table_info(Entry)`).all() as { name: string }[];
        const names = new Set(cols.map(c => c.name));
        expect(names.has('IsPinned')).toBe(true);
        expect(names.has('PinnedDate')).toBe(true);
    });
});

describe('Pin — toggle', () => {
    it('pin sets IsPinned=1 + PinnedDate', async () => {
        const id = await entry('hi');
        await pinEntry(dbm, id);
        const row = await dbm.prepare('SELECT IsPinned, PinnedDate FROM Entry WHERE EntryID = ?').get(id) as any;
        expect(row.IsPinned).toBe(1);
        expect(row.PinnedDate).toBeTruthy();
    });

    it('unpin clears IsPinned + PinnedDate', async () => {
        const id = await entry('hi');
        await pinEntry(dbm, id);
        await unpinEntry(dbm, id);
        const row = await dbm.prepare('SELECT IsPinned, PinnedDate FROM Entry WHERE EntryID = ?').get(id) as any;
        expect(row.IsPinned).toBe(0);
        expect(row.PinnedDate).toBeNull();
    });
});

describe('Pin — list', () => {
    it('lists pinned entries ordered by PinnedDate desc', async () => {
        const a = await entry('a');
        const b = await entry('b');
        const c = await entry('c');
        await pinEntry(dbm, a);
        await new Promise(r => setTimeout(r, 5));
        await pinEntry(dbm, b);
        // c remains unpinned

        const list = await listPinned(dbm, USER_ID);
        const ids = list.map(r => r.EntryID);
        expect(ids).toContain(a);
        expect(ids).toContain(b);
        expect(ids).not.toContain(c);
        // b pinned later → should come first
        expect(ids[0]).toBe(b);
    });

    it('filters by category when categoryId is given', async () => {
        const otherCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'O', 'Notebook');
        const a = await entry('a');
        const oR = await dbm.prepare(`INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`).run(otherCat.lastInsertRowid, 'other-pin', '');
        await pinEntry(dbm, a);
        await pinEntry(dbm, oR.lastInsertRowid);

        const list = await listPinned(dbm, USER_ID, categoryId);
        const ids = list.map(r => r.EntryID);
        expect(ids).toEqual([a]);
    });

    it('excludes soft-deleted entries', async () => {
        const a = await entry('a');
        await pinEntry(dbm, a);
        await dbm.prepare(`UPDATE Entry SET IsDeleted = 1, DeletedDate = CURRENT_TIMESTAMP WHERE EntryID = ?`).run(a);
        const list = await listPinned(dbm, USER_ID);
        expect(list.map(r => r.EntryID)).not.toContain(a);
    });
});
