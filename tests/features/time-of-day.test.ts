/**
 * Feature: entriesByHour / entriesByWeekday — David RM "when do you write?"
 *  - 24 / 7 dense buckets every call (zero-fill).
 *  - Counts respect soft-delete and user scope.
 *  - Folders (EntryType != Page) excluded.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { entriesByHour, entriesByWeekday } from '../../src/lib/stats';

const TEST_DB_PATH = join(process.cwd(), `test-tod-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
const OTHER_USER_ID = 2;
let categoryId: number;
let otherCategoryId: number;

async function entry(createdDate: string, opts: {
    isDeleted?: boolean;
    categoryId?: number;
    entryType?: 'Page' | 'Folder';
} = {}): Promise<number> {
    const cat = opts.categoryId ?? categoryId;
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate, EntryType, IsDeleted)
         VALUES (?, '', '', ?, ?, ?)`
    ).run(cat, createdDate, opts.entryType ?? 'Page', opts.isDeleted ? 1 : 0);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'me');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(OTHER_USER_ID, 'other');
    const a = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'mine', 'Journal');
    categoryId = a.lastInsertRowid;
    const b = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(OTHER_USER_ID, 'theirs', 'Journal');
    otherCategoryId = b.lastInsertRowid;
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

describe('entriesByHour', () => {
    it('returns 24 dense zero buckets when empty', async () => {
        const out = await entriesByHour(dbm, USER_ID);
        expect(out).toHaveLength(24);
        expect(out.every(b => b.count === 0)).toBe(true);
        expect(out.map(b => b.hour)).toEqual([...Array(24).keys()]);
    });

    it('counts entries into their hour bucket', async () => {
        await entry('2026-05-14 09:00:00');
        await entry('2026-05-14 09:45:30');   // same hour
        await entry('2026-05-14 23:01:00');
        const out = await entriesByHour(dbm, USER_ID);
        expect(out[9].count).toBe(2);
        expect(out[23].count).toBe(1);
        // others stay zero
        expect(out.filter(b => b.hour !== 9 && b.hour !== 23).every(b => b.count === 0)).toBe(true);
    });

    it('excludes soft-deleted entries', async () => {
        await entry('2026-05-14 12:00:00');
        await entry('2026-05-14 12:00:00', { isDeleted: true });
        expect((await entriesByHour(dbm, USER_ID))[12].count).toBe(1);
    });

    it('excludes folders', async () => {
        await entry('2026-05-14 08:00:00', { entryType: 'Folder' });
        await entry('2026-05-14 08:00:00');
        expect((await entriesByHour(dbm, USER_ID))[8].count).toBe(1);
    });

    it('is scoped per user', async () => {
        await entry('2026-05-14 10:00:00');
        await entry('2026-05-14 10:00:00', { categoryId: otherCategoryId });
        expect((await entriesByHour(dbm, USER_ID))[10].count).toBe(1);
        expect((await entriesByHour(dbm, OTHER_USER_ID))[10].count).toBe(1);
    });
});

describe('entriesByWeekday', () => {
    it('returns 7 dense zero buckets when empty', async () => {
        const out = await entriesByWeekday(dbm, USER_ID);
        expect(out).toHaveLength(7);
        expect(out.map(b => b.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('counts entries into their weekday bucket', async () => {
        // strftime('%w') — 0=Sun..6=Sat. 2026-05-14 is a Thursday (weekday=4).
        await entry('2026-05-14 12:00:00');
        await entry('2026-05-17 12:00:00');   // Sunday (weekday=0)
        await entry('2026-05-17 13:00:00');   // Sunday
        const out = await entriesByWeekday(dbm, USER_ID);
        expect(out[4].count).toBe(1);   // Thu
        expect(out[0].count).toBe(2);   // Sun
    });

    it('excludes soft-deleted', async () => {
        await entry('2026-05-14 12:00:00', { isDeleted: true });
        expect((await entriesByWeekday(dbm, USER_ID)).every(b => b.count === 0)).toBe(true);
    });
});
