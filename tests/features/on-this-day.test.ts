/**
 * Feature: On This Day
 *  - onThisDay(userId, today) returns entries whose CreatedDate falls on the same
 *    MM-DD as `today`, grouped by year, oldest year first.
 *  - Excludes soft-deleted entries.
 *  - Scoped to the requesting user.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { onThisDay } from '../../src/lib/anniversary';

const TEST_DB_PATH = join(process.cwd(), `test-otd-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function entry(createdDate: string, title = 't', extraSql = ''): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate${extraSql ? `, ${extraSql.split('=')[0]}` : ''})
         VALUES (?, ?, ?, ?${extraSql ? `, ${extraSql.split('=')[1]}` : ''})`
    ).run(categoryId, title, '', createdDate);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'otd');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'OTD', 'Journal');
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

describe('onThisDay', () => {
    it('returns entries from the same MM-DD across prior years', async () => {
        await entry('2023-05-13 12:00:00', 'a');
        await entry('2022-05-13 12:00:00', 'b');
        await entry('2024-05-14 12:00:00', 'c'); // different day, excluded
        await entry('2020-12-25 12:00:00', 'd'); // different day

        const r = await onThisDay(dbm, USER_ID, new Date('2026-05-13T12:00:00'));
        const titles = r.map(x => x.Title).sort();
        expect(titles).toEqual(['a', 'b']);
    });

    it('orders results oldest year first (so user sees a timeline)', async () => {
        await entry('2024-05-13 12:00:00', 'recent');
        await entry('2020-05-13 12:00:00', 'oldest');
        await entry('2022-05-13 12:00:00', 'middle');

        const r = await onThisDay(dbm, USER_ID, new Date('2026-05-13T12:00:00'));
        expect(r.map(x => x.Title)).toEqual(['oldest', 'middle', 'recent']);
    });

    it('excludes entries from the current year (don\'t show "today")', async () => {
        const today = new Date('2026-05-13T12:00:00');
        await entry('2026-05-13 09:00:00', 'today-entry');
        await entry('2023-05-13 12:00:00', 'past-entry');
        const r = await onThisDay(dbm, USER_ID, today);
        expect(r.map(x => x.Title)).toEqual(['past-entry']);
    });

    it('excludes soft-deleted entries', async () => {
        const id = await entry('2023-05-13 12:00:00', 'gone');
        await dbm.prepare('UPDATE Entry SET IsDeleted = 1, DeletedDate = CURRENT_TIMESTAMP WHERE EntryID = ?').run(id);
        const r = await onThisDay(dbm, USER_ID, new Date('2026-05-13T12:00:00'));
        expect(r).toEqual([]);
    });

    it('scoped to user — does not leak entries from another user', async () => {
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'other');
        const otherCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(99, 'X', 'Journal');
        await dbm.prepare(`INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate) VALUES (?, ?, ?, ?)`)
            .run(otherCat.lastInsertRowid, 'theirs', '', '2023-05-13 12:00:00');
        await entry('2023-05-13 12:00:00', 'mine');

        const r = await onThisDay(dbm, USER_ID, new Date('2026-05-13T12:00:00'));
        expect(r.map(x => x.Title)).toEqual(['mine']);
    });

    it('handles Feb 29 → falls back to no anniversary on non-leap year (returns empty)', async () => {
        await entry('2020-02-29 12:00:00', 'leap');
        // 2026 is not a leap year — Feb 29 doesn't exist
        const r = await onThisDay(dbm, USER_ID, new Date('2026-02-28T12:00:00'));
        expect(r.map(x => x.Title)).not.toContain('leap');
    });
});
