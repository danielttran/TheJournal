/**
 * Recently-accessed entries.
 *  - touchEntry(dbm, userId, entryId) bumps Entry.LastAccessedDate to now
 *  - listRecent(dbm, userId, limit) returns top-N entries by LastAccessedDate desc
 *  - Excludes soft-deleted entries
 *  - Scoped to user via Category JOIN
 *  - Non-owner touch is silently ignored
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { touchEntry, listRecent } from '../../src/lib/recent';

const TEST_DB_PATH = join(process.cwd(), `test-recent-${Date.now()}.tjdb`);
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
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'r');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'o');
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
    await dbm.prepare(`DELETE FROM Entry WHERE CategoryID = ?`).run(categoryId);
});

describe('touchEntry', () => {
    it('stamps LastAccessedDate on first touch', async () => {
        const id = await entry('a');
        const before = await dbm.prepare('SELECT LastAccessedDate FROM Entry WHERE EntryID = ?').get(id) as { LastAccessedDate: string | null };
        expect(before.LastAccessedDate).toBeNull();

        await touchEntry(dbm, USER_ID, id);
        const after = await dbm.prepare('SELECT LastAccessedDate FROM Entry WHERE EntryID = ?').get(id) as { LastAccessedDate: string | null };
        expect(after.LastAccessedDate).toBeTruthy();
    });

    it('updates timestamp on subsequent touch', async () => {
        const id = await entry('a');
        await touchEntry(dbm, USER_ID, id);
        const t1 = await dbm.prepare('SELECT LastAccessedDate FROM Entry WHERE EntryID = ?').get(id) as { LastAccessedDate: string };
        await new Promise(r => setTimeout(r, 1100));
        await touchEntry(dbm, USER_ID, id);
        const t2 = await dbm.prepare('SELECT LastAccessedDate FROM Entry WHERE EntryID = ?').get(id) as { LastAccessedDate: string };
        expect(t2.LastAccessedDate > t1.LastAccessedDate).toBe(true);
    });

    it('does not stamp another user\'s entry', async () => {
        const otherCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(99, 'OC', 'Notebook');
        const theirs = await dbm.prepare(`INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, 't', '')`).run(otherCat.lastInsertRowid);
        await touchEntry(dbm, USER_ID, theirs.lastInsertRowid as number);
        const row = await dbm.prepare('SELECT LastAccessedDate FROM Entry WHERE EntryID = ?').get(theirs.lastInsertRowid) as { LastAccessedDate: string | null };
        expect(row.LastAccessedDate).toBeNull();
    });
});

describe('listRecent', () => {
    it('returns top-N entries sorted by LastAccessedDate desc', async () => {
        const a = await entry('a');
        const b = await entry('b');
        const c = await entry('c');
        await touchEntry(dbm, USER_ID, a);
        await new Promise(r => setTimeout(r, 1100));
        await touchEntry(dbm, USER_ID, b);
        await new Promise(r => setTimeout(r, 1100));
        await touchEntry(dbm, USER_ID, c);

        const recent = await listRecent(dbm, USER_ID, 10);
        expect(recent.map(r => r.EntryID)).toEqual([c, b, a]);
    });

    it('excludes never-accessed entries', async () => {
        const a = await entry('a');
        await entry('b'); // never touched
        await touchEntry(dbm, USER_ID, a);
        const recent = await listRecent(dbm, USER_ID, 10);
        expect(recent.length).toBe(1);
        expect(recent[0].EntryID).toBe(a);
    });

    it('excludes soft-deleted entries', async () => {
        const a = await entry('a');
        await touchEntry(dbm, USER_ID, a);
        await dbm.prepare('UPDATE Entry SET IsDeleted = 1 WHERE EntryID = ?').run(a);
        const recent = await listRecent(dbm, USER_ID, 10);
        expect(recent.length).toBe(0);
    });

    it('respects limit', async () => {
        for (let i = 0; i < 5; i++) {
            const id = await entry(`e${i}`);
            await touchEntry(dbm, USER_ID, id);
        }
        const r = await listRecent(dbm, USER_ID, 3);
        expect(r.length).toBe(3);
    });

    it('scoped to user', async () => {
        await dbm.prepare(`INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)`).run(99, 'OC', 'Notebook');
        const recent = await listRecent(dbm, USER_ID, 10);
        expect(recent.length).toBe(0);
    });
});
