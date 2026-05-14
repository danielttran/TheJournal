/**
 * Hour-of-day activity stat.
 *  - hourActivity(userId, days) returns 24 buckets {hour, entryCount, wordCount}
 *  - Aggregates over entries created in the last `days` days
 *  - Excludes soft-deleted entries
 *  - Scoped to user
 *  - Each bucket index = local hour 0..23
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { hourActivity } from '../../src/lib/hourActivity';

const TEST_DB_PATH = join(process.cwd(), `test-hour-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function entry(createdDate: string, html: string): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate) VALUES (?, 't', '', ?)`
    ).run(categoryId, createdDate);
    await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(r.lastInsertRowid, html);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'ha');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'HA', 'Journal');
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

describe('hourActivity', () => {
    it('returns exactly 24 buckets, indexed 0..23', async () => {
        const buckets = await hourActivity(dbm, USER_ID, 365);
        expect(buckets.length).toBe(24);
        expect(buckets.map(b => b.hour)).toEqual([...Array(24).keys()]);
    });

    it('counts entries and words by their CreatedDate hour', async () => {
        const today = new Date().toISOString().slice(0, 10);
        await entry(`${today} 09:30:00`, '<p>one two</p>');
        await entry(`${today} 09:55:00`, '<p>three</p>');
        await entry(`${today} 22:00:00`, '<p>four five</p>');

        const buckets = await hourActivity(dbm, USER_ID, 7);
        const at = (h: number) => buckets[h];

        expect(at(9).entryCount).toBe(2);
        expect(at(9).wordCount).toBe(3);
        expect(at(22).entryCount).toBe(1);
        expect(at(22).wordCount).toBe(2);
        expect(at(0).entryCount).toBe(0);
    });

    it('excludes entries older than the window', async () => {
        // 1000 days ago is well outside any reasonable window
        await entry('2010-01-01 12:00:00', '<p>ancient</p>');
        const buckets = await hourActivity(dbm, USER_ID, 7);
        expect(buckets.reduce((s, b) => s + b.entryCount, 0)).toBe(0);
    });

    it('excludes soft-deleted entries', async () => {
        const today = new Date().toISOString().slice(0, 10);
        const id = await entry(`${today} 09:00:00`, '<p>hi</p>');
        await dbm.prepare('UPDATE Entry SET IsDeleted = 1 WHERE EntryID = ?').run(id);
        const buckets = await hourActivity(dbm, USER_ID, 7);
        expect(buckets[9].entryCount).toBe(0);
    });
});
