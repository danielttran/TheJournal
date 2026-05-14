/**
 * Audit: FTS5 + soft-delete + auth interactions
 *  - Soft-deleted entries should NOT surface in /api/search
 *  - permaDelete should remove the row from EntrySearch
 *  - Restore should make the entry searchable again
 *  - Search must scope to the current user
 *  - Purge (per-user) must NOT touch another user's deleted entries
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    softDeleteEntry, restoreEntry, permanentlyDeleteEntry, purgeOldDeletedEntries,
} from '../../src/lib/trash';

const TEST_DB_PATH = join(process.cwd(), `test-fts-sd-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
let categoryId: number;
const USER_ID = 1;
const OTHER_USER_ID = 2;

async function makeEntry(catId: number, title: string, body: string): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`
    ).run(catId, title, '');
    await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(r.lastInsertRowid, body);
    return r.lastInsertRowid;
}

/** Mimic /api/search WHERE clause minus the FTS join — easier to test deterministically. */
async function searchTitle(userId: number, term: string): Promise<{ EntryID: number; Title: string }[]> {
    return dbm.prepare(`
        SELECT e.EntryID, e.Title FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND e.IsDeleted = 0 AND e.Title LIKE ?
    `).all(userId, `%${term}%`) as Promise<any[]>;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'a');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(OTHER_USER_ID, 'b');
    const cat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'C', 'Notebook');
    categoryId = cat.lastInsertRowid;
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Entry').run();
});

describe('FTS / soft-delete interaction', () => {
    it('soft-deleted entries are filtered out of search SQL', async () => {
        const a = await makeEntry(categoryId, 'searchable', '<p>body</p>');
        await softDeleteEntry(dbm, a);
        const results = await searchTitle(USER_ID, 'searchable');
        expect(results.length).toBe(0);
    });

    it('restored entries reappear in search', async () => {
        const a = await makeEntry(categoryId, 'unique-bear', '<p>body</p>');
        await softDeleteEntry(dbm, a);
        expect((await searchTitle(USER_ID, 'unique-bear')).length).toBe(0);
        await restoreEntry(dbm, a);
        expect((await searchTitle(USER_ID, 'unique-bear')).length).toBe(1);
    });

    it('permanently deleting removes the row from EntrySearch (FTS5)', async () => {
        const a = await makeEntry(categoryId, 'doomed', '<p>body</p>');
        await softDeleteEntry(dbm, a);
        await permanentlyDeleteEntry(dbm, a);
        const fts = await dbm.prepare(`SELECT rowid FROM EntrySearch WHERE rowid = ?`).get(a);
        expect(fts).toBeUndefined();
    });
});

describe('Per-user purge isolation', () => {
    it('purgeOldDeletedEntries(userId=A) does NOT touch user B\'s deleted entries', async () => {
        const otherCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(OTHER_USER_ID, 'B', 'Notebook');

        // Both users have an "old" deleted entry
        const mine = await makeEntry(categoryId, 'mine', '<p>x</p>');
        const theirs = await makeEntry(otherCat.lastInsertRowid, 'theirs', '<p>x</p>');
        await dbm.prepare(`UPDATE Entry SET IsDeleted = 1, DeletedDate = datetime('now', '-40 days') WHERE EntryID IN (?, ?)`).run(mine, theirs);

        const purged = await purgeOldDeletedEntries(dbm, 30, USER_ID);
        expect(purged).toBe(1);

        const mineGone = await dbm.prepare('SELECT 1 FROM Entry WHERE EntryID = ?').get(mine);
        const theirsStill = await dbm.prepare('SELECT 1 FROM Entry WHERE EntryID = ?').get(theirs);
        expect(mineGone).toBeUndefined();
        expect(theirsStill).toBeDefined();
    });

    it('global (no-userId) purge still works for system-level callers', async () => {
        const otherCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(OTHER_USER_ID, 'B', 'Notebook');
        const mine = await makeEntry(categoryId, 'mine', '<p>x</p>');
        const theirs = await makeEntry(otherCat.lastInsertRowid, 'theirs', '<p>x</p>');
        await dbm.prepare(`UPDATE Entry SET IsDeleted = 1, DeletedDate = datetime('now', '-40 days') WHERE EntryID IN (?, ?)`).run(mine, theirs);

        const purged = await purgeOldDeletedEntries(dbm, 30); // no userId
        expect(purged).toBe(2);
    });
});
