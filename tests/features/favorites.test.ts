/**
 * Feature: Favorites (David RM parity)
 *  - listFavorites returns starred Page entries newest-first, scoped to user.
 *  - Soft-deleted entries are excluded.
 *  - toggleFavorite flips the flag; returns the new state.
 *  - toggleFavorite refuses to touch entries owned by other users.
 *  - categoryId/limit options.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { listFavorites, toggleFavorite } from '../../src/lib/favorites';

const TEST_DB_PATH = join(process.cwd(), `test-favs-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
const OTHER_USER_ID = 2;
let myCategory: number;
let otherCategory: number;

async function entry(title: string, opts: {
    categoryId?: number;
    isDeleted?: boolean;
    isFavorited?: boolean;
    modifiedDate?: string;
} = {}): Promise<number> {
    const cat = opts.categoryId ?? myCategory;
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, EntryType,
                            IsDeleted, IsFavorited, ModifiedDate)
         VALUES (?, ?, '', 'Page', ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`
    ).run(
        cat, title,
        opts.isDeleted ? 1 : 0,
        opts.isFavorited ? 1 : 0,
        opts.modifiedDate ?? null
    );
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'me');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(OTHER_USER_ID, 'other');
    const a = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'mine', 'Journal');
    myCategory = a.lastInsertRowid;
    const b = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(OTHER_USER_ID, 'theirs', 'Journal');
    otherCategory = b.lastInsertRowid;
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

describe('listFavorites', () => {
    it('returns empty when nothing is starred', async () => {
        await entry('plain');
        expect(await listFavorites(dbm, USER_ID)).toEqual([]);
    });

    it('returns only starred entries', async () => {
        await entry('plain');
        await entry('starred', { isFavorited: true });
        const list = await listFavorites(dbm, USER_ID);
        expect(list.map(e => e.Title)).toEqual(['starred']);
    });

    it('orders newest first by ModifiedDate', async () => {
        await entry('old',    { isFavorited: true, modifiedDate: '2020-01-01 00:00:00' });
        await entry('newest', { isFavorited: true, modifiedDate: '2026-12-31 00:00:00' });
        await entry('mid',    { isFavorited: true, modifiedDate: '2024-06-15 00:00:00' });
        const list = await listFavorites(dbm, USER_ID);
        expect(list.map(e => e.Title)).toEqual(['newest', 'mid', 'old']);
    });

    it('excludes soft-deleted starred entries', async () => {
        await entry('alive',  { isFavorited: true });
        await entry('trashed',{ isFavorited: true, isDeleted: true });
        const list = await listFavorites(dbm, USER_ID);
        expect(list.map(e => e.Title)).toEqual(['alive']);
    });

    it('only returns entries the calling user owns', async () => {
        await entry('mine',   { isFavorited: true });
        await entry('theirs', { isFavorited: true, categoryId: otherCategory });
        const mine = await listFavorites(dbm, USER_ID);
        const theirs = await listFavorites(dbm, OTHER_USER_ID);
        expect(mine.map(e => e.Title)).toEqual(['mine']);
        expect(theirs.map(e => e.Title)).toEqual(['theirs']);
    });

    it('respects categoryId scope', async () => {
        const secondCat = (await dbm.prepare(
            'INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)'
        ).run(USER_ID, 'second', 'Journal')).lastInsertRowid;

        await entry('cat-a', { isFavorited: true });
        await entry('cat-b', { isFavorited: true, categoryId: secondCat });

        const scoped = await listFavorites(dbm, USER_ID, { categoryId: secondCat });
        expect(scoped.map(e => e.Title)).toEqual(['cat-b']);
    });

    it('respects limit option', async () => {
        for (let i = 0; i < 5; i++) {
            await entry(`f${i}`, { isFavorited: true, modifiedDate: `2020-01-0${i + 1} 00:00:00` });
        }
        const list = await listFavorites(dbm, USER_ID, { limit: 2 });
        expect(list).toHaveLength(2);
    });
});

describe('toggleFavorite', () => {
    it('flips false → true and returns the new state', async () => {
        const id = await entry('plain');
        expect(await toggleFavorite(dbm, USER_ID, id)).toBe(true);
        expect((await listFavorites(dbm, USER_ID)).map(e => e.Title)).toEqual(['plain']);
    });

    it('flips true → false on a second call', async () => {
        const id = await entry('starred', { isFavorited: true });
        expect(await toggleFavorite(dbm, USER_ID, id)).toBe(false);
        expect(await listFavorites(dbm, USER_ID)).toEqual([]);
    });

    it('returns null for an unknown entry', async () => {
        expect(await toggleFavorite(dbm, USER_ID, 999999)).toBeNull();
    });

    it('refuses to toggle an entry owned by another user', async () => {
        const theirId = await entry('theirs', { categoryId: otherCategory });
        expect(await toggleFavorite(dbm, USER_ID, theirId)).toBeNull();

        // Verify the other user's entry wasn't mutated.
        const row = await dbm.prepare('SELECT IsFavorited FROM Entry WHERE EntryID = ?').get(theirId) as
            { IsFavorited: number };
        expect(row.IsFavorited).toBe(0);
    });
});
