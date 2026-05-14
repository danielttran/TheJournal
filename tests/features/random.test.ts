/**
 * Feature: Surprise-me / Random entry
 *  - pickRandomEntry returns a random non-deleted Page entry for the user.
 *  - Soft-deleted entries are excluded.
 *  - Locked entries are excluded by default; opt-in via includeLocked.
 *  - categoryId scopes the pool.
 *  - Returns null when the pool is empty.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { pickRandomEntry } from '../../src/lib/random';

const TEST_DB_PATH = join(process.cwd(), `test-random-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryA: number;
let categoryB: number;

async function entry(title: string, opts: {
    categoryId?: number;
    isDeleted?: boolean;
    isLocked?: boolean;
} = {}): Promise<number> {
    const cat = opts.categoryId ?? categoryA;
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, EntryType, IsDeleted, IsLocked)
         VALUES (?, ?, '', 'Page', ?, ?)`
    ).run(cat, title, opts.isDeleted ? 1 : 0, opts.isLocked ? 1 : 0);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)')
        .run(USER_ID, 'rand');
    const a = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)')
        .run(USER_ID, 'A', 'Journal');
    categoryA = a.lastInsertRowid;
    const b = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)')
        .run(USER_ID, 'B', 'Journal');
    categoryB = b.lastInsertRowid;
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

describe('pickRandomEntry', () => {
    it('returns null when there are no entries', async () => {
        const picked = await pickRandomEntry(dbm, USER_ID);
        expect(picked).toBeNull();
    });

    it('returns the only entry when there is exactly one', async () => {
        await entry('alone');
        const picked = await pickRandomEntry(dbm, USER_ID);
        expect(picked).not.toBeNull();
        expect(picked!.Title).toBe('alone');
    });

    it('eventually returns each entry across many calls (uniformity smoke test)', async () => {
        const ids = [
            await entry('a'),
            await entry('b'),
            await entry('c'),
        ];
        const seen = new Set<number>();
        // 30 draws with 3 candidates: P(any one missing) ≈ (2/3)^30 ≈ 5e-6.
        for (let i = 0; i < 30; i++) {
            const p = await pickRandomEntry(dbm, USER_ID);
            expect(p).not.toBeNull();
            seen.add(p!.EntryID);
        }
        for (const id of ids) expect(seen.has(id)).toBe(true);
    });

    it('excludes soft-deleted entries', async () => {
        await entry('alive');
        await entry('trashed', { isDeleted: true });
        for (let i = 0; i < 20; i++) {
            const p = await pickRandomEntry(dbm, USER_ID);
            expect(p!.Title).toBe('alive');
        }
    });

    it('excludes locked entries by default', async () => {
        await entry('public');
        await entry('secret', { isLocked: true });
        for (let i = 0; i < 20; i++) {
            const p = await pickRandomEntry(dbm, USER_ID);
            expect(p!.Title).toBe('public');
        }
    });

    it('includes locked entries when includeLocked=true', async () => {
        const lockedId = await entry('secret', { isLocked: true });
        const seen = new Set<number>();
        for (let i = 0; i < 20; i++) {
            const p = await pickRandomEntry(dbm, USER_ID, { includeLocked: true });
            seen.add(p!.EntryID);
        }
        expect(seen.has(lockedId)).toBe(true);
    });

    it('scopes the pick to a given categoryId', async () => {
        await entry('a-1');
        await entry('a-2');
        const b1 = await entry('b-1', { categoryId: categoryB });

        const seen = new Set<number>();
        for (let i = 0; i < 30; i++) {
            const p = await pickRandomEntry(dbm, USER_ID, { categoryId: categoryB });
            expect(p!.CategoryID).toBe(categoryB);
            seen.add(p!.EntryID);
        }
        // Only one B-category entry exists.
        expect(seen.size).toBe(1);
        expect(seen.has(b1)).toBe(true);
    });

    it('excludes folders (EntryType != Page)', async () => {
        await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, EntryType, IsDeleted, IsLocked)
             VALUES (?, 'folder', '', 'Folder', 0, 0)`
        ).run(categoryA);
        await entry('page');
        for (let i = 0; i < 20; i++) {
            const p = await pickRandomEntry(dbm, USER_ID);
            expect(p!.Title).toBe('page');
        }
    });
});
