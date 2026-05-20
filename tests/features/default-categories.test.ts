/**
 * On first login (registration), DavidRM seeds the user's journal with two
 * starter categories — a calendar-style "Daily Journal" and a loose-leaf
 * "Notebook" — so the user lands on a usable layout instead of an empty
 * sidebar. Tests verify the helper is:
 *
 *  - Idempotent: calling it twice for the same user doesn't duplicate.
 *  - Scoped: only seeds for the calling user; other users are untouched.
 *  - Non-destructive: skips seeding when the user already owns ANY
 *    category (so re-running on an existing journal is a no-op).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { seedDefaultCategories } from '../../src/lib/defaultCategories';

const TEST_DB_PATH = join(process.cwd(), `test-seed-cats-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Category').run();
    await dbm.prepare('DELETE FROM User').run();
});

describe('seedDefaultCategories', () => {
    it('creates Daily Journal (Journal) and Notebook (Notebook) for a fresh user', async () => {
        const u = await dbm.prepare('INSERT INTO User (Username) VALUES (?)').run('alice');
        const userId = Number(u.lastInsertRowid);

        const created = await seedDefaultCategories(dbm, userId);
        expect(created).toBe(2);

        const cats = await dbm.prepare(
            'SELECT Name, Type FROM Category WHERE UserID = ? ORDER BY SortOrder ASC'
        ).all(userId) as { Name: string; Type: string }[];
        expect(cats).toEqual([
            { Name: 'Daily Journal', Type: 'Journal' },
            { Name: 'Notebook', Type: 'Notebook' },
        ]);
    });

    it('returns 0 and creates nothing when the user already owns categories', async () => {
        const u = await dbm.prepare('INSERT INTO User (Username) VALUES (?)').run('bob');
        const userId = Number(u.lastInsertRowid);
        await dbm.prepare(
            `INSERT INTO Category (UserID, Name, Type) VALUES (?, 'Custom', 'Notebook')`
        ).run(userId);

        const created = await seedDefaultCategories(dbm, userId);
        expect(created).toBe(0);

        const count = await dbm.prepare(
            'SELECT COUNT(*) AS n FROM Category WHERE UserID = ?'
        ).get(userId) as { n: number };
        // Existing 'Custom' category preserved; no new ones inserted.
        expect(count.n).toBe(1);
    });

    it('idempotent — calling it twice produces only one set of defaults', async () => {
        const u = await dbm.prepare('INSERT INTO User (Username) VALUES (?)').run('carol');
        const userId = Number(u.lastInsertRowid);
        const first = await seedDefaultCategories(dbm, userId);
        const second = await seedDefaultCategories(dbm, userId);
        expect(first).toBe(2);
        expect(second).toBe(0);
        const count = await dbm.prepare(
            'SELECT COUNT(*) AS n FROM Category WHERE UserID = ?'
        ).get(userId) as { n: number };
        expect(count.n).toBe(2);
    });

    it('user-scoped — seeding for user A leaves user B untouched', async () => {
        const a = await dbm.prepare('INSERT INTO User (Username) VALUES (?)').run('userA');
        const b = await dbm.prepare('INSERT INTO User (Username) VALUES (?)').run('userB');
        const aId = Number(a.lastInsertRowid);
        const bId = Number(b.lastInsertRowid);

        await seedDefaultCategories(dbm, aId);

        const aCount = await dbm.prepare(
            'SELECT COUNT(*) AS n FROM Category WHERE UserID = ?'
        ).get(aId) as { n: number };
        const bCount = await dbm.prepare(
            'SELECT COUNT(*) AS n FROM Category WHERE UserID = ?'
        ).get(bId) as { n: number };
        expect(aCount.n).toBe(2);
        expect(bCount.n).toBe(0);
    });

    it('throws on an invalid userId rather than silently writing categories with no owner', async () => {
        // Userid that doesn't exist in the User table — UserID has a FOREIGN KEY
        // constraint, so the INSERT should fail.
        await expect(seedDefaultCategories(dbm, 9999)).rejects.toThrow();
    });
});
