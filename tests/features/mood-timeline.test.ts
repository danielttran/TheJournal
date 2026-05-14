/**
 * Feature: moodByMonth — David RM parity mood timeline
 *  - Aggregates Entry.Mood counts by calendar month.
 *  - Returns oldest-month first, monthsBack windows ending at "now".
 *  - Months with no mood entries still appear with empty counts (dense X axis).
 *  - Excludes soft-deleted and empty-mood entries.
 *  - Scoped to userId.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { moodByMonth } from '../../src/lib/stats';

const TEST_DB_PATH = join(process.cwd(), `test-moodts-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
const OTHER_USER_ID = 2;
let categoryId: number;
let otherCategoryId: number;

async function entry(createdDate: string, mood: string | null, opts: {
    isDeleted?: boolean;
    categoryId?: number;
} = {}): Promise<number> {
    const cat = opts.categoryId ?? categoryId;
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate, Mood,
                            EntryType, IsDeleted)
         VALUES (?, '', '', ?, ?, 'Page', ?)`
    ).run(cat, createdDate, mood, opts.isDeleted ? 1 : 0);
    return r.lastInsertRowid;
}

function monthKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

describe('moodByMonth', () => {
    it('returns N months of zero buckets when there are no entries', async () => {
        const out = await moodByMonth(dbm, USER_ID, 6);
        expect(out).toHaveLength(6);
        for (const m of out) {
            expect(m.counts).toEqual({});
            expect(m.total).toBe(0);
        }
        // Oldest first, newest last.
        const now = new Date();
        expect(out[out.length - 1].month).toBe(monthKey(now));
    });

    it('aggregates mood counts within a single month', async () => {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15 12:00:00`;
        await entry(today, 'happy');
        await entry(today, 'happy');
        await entry(today, 'calm');
        const out = await moodByMonth(dbm, USER_ID, 3);
        const current = out[out.length - 1];
        expect(current.counts).toEqual({ happy: 2, calm: 1 });
        expect(current.total).toBe(3);
    });

    it('separates counts across months', async () => {
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 5).toISOString().slice(0, 10) + ' 12:00:00';
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 5).toISOString().slice(0, 10) + ' 12:00:00';
        await entry(thisMonth, 'happy');
        await entry(lastMonth, 'sad');

        const out = await moodByMonth(dbm, USER_ID, 3);
        const cur  = out[out.length - 1];
        const prev = out[out.length - 2];
        expect(cur.counts).toEqual({ happy: 1 });
        expect(prev.counts).toEqual({ sad: 1 });
    });

    it('excludes empty mood and soft-deleted entries', async () => {
        const now = new Date();
        const day = new Date(now.getFullYear(), now.getMonth(), 10).toISOString().slice(0, 10) + ' 12:00:00';
        await entry(day, null);                          // no mood
        await entry(day, '');                            // empty mood
        await entry(day, 'happy', { isDeleted: true });  // trashed
        await entry(day, 'sad');                         // counted

        const out = await moodByMonth(dbm, USER_ID, 1);
        expect(out[0].counts).toEqual({ sad: 1 });
        expect(out[0].total).toBe(1);
    });

    it('is scoped per user', async () => {
        const now = new Date();
        const day = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10) + ' 12:00:00';
        await entry(day, 'mine');
        await entry(day, 'theirs', { categoryId: otherCategoryId });

        const mine = await moodByMonth(dbm, USER_ID, 1);
        const theirs = await moodByMonth(dbm, OTHER_USER_ID, 1);
        expect(mine[0].counts).toEqual({ mine: 1 });
        expect(theirs[0].counts).toEqual({ theirs: 1 });
    });

    it('clamps monthsBack to at least 1', async () => {
        expect(await moodByMonth(dbm, USER_ID, 0)).toHaveLength(1);
        expect(await moodByMonth(dbm, USER_ID, -5)).toHaveLength(1);
    });

    it('drops entries older than the window', async () => {
        const wayBack = '2018-01-15 12:00:00';
        await entry(wayBack, 'ancient');
        const out = await moodByMonth(dbm, USER_ID, 3);
        for (const m of out) expect(m.counts).toEqual({});
    });
});
