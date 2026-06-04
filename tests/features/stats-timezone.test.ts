/**
 * Stats date-bucketing must use the user's calendar day, not a doubly-converted
 * one. Regression: stats applied date(CreatedDate, 'localtime') to values that
 * are ALREADY stored as naive local time (by-date journal entries at noon),
 * so SQLite re-interpreted them as UTC and shifted the day. In far-east zones
 * (UTC+13/+14) a daily journal writer's currentStreak collapsed to 0.
 *
 * TZ is pinned BEFORE any app/native module loads (hence dynamic imports below)
 * so the SQLite 'localtime' modifier and JS Date share the far-east offset.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DBManager } from '../../src/lib/db';
import type { currentStreak as CurrentStreak, entriesPerDay as EntriesPerDay } from '../../src/lib/stats';
process.env.TZ = 'Pacific/Kiritimati'; // UTC+14

const PATH = `/tmp/stats-tz-${Date.now()}.tjdb`;
const KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
let currentStreak: typeof CurrentStreak;
let entriesPerDay: typeof EntriesPerDay;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

beforeAll(async () => {
    const db = await import('../../src/lib/db');
    const stats = await import('../../src/lib/stats');
    currentStreak = stats.currentStreak;
    entriesPerDay = stats.entriesPerDay;
    dbm = new db.DBManager(PATH);
    await dbm.unlock(KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (1, ?)').run('tz');
    const c = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (1, ?, ?)').run('J', 'Journal');
    const cat = c.lastInsertRowid;
    // By-date journal entries (noon-naive local) for today and yesterday.
    for (const offset of [0, 1]) {
        const d = new Date(Date.now() - offset * 86_400_000);
        await dbm.prepare('INSERT INTO Entry (CategoryID, Title, CreatedDate) VALUES (?, ?, ?)')
            .run(cat, 'e', `${ymd(d)} 12:00:00`);
    }
});

afterAll(async () => {
    await dbm?.close();
    const { unlink } = await import('fs/promises');
    for (const s of ['', '-wal', '-shm']) await unlink(PATH + s).catch(() => {});
});

describe('stats date bucketing in a far-east timezone (UTC+14)', () => {
    it('counts a daily journal writer as a 2-day streak (not 0)', async () => {
        expect(await currentStreak(dbm, 1)).toBe(2);
    });

    it("files today's entry under today's local date, not shifted forward", async () => {
        const buckets = await entriesPerDay(dbm, 1, 7);
        const todayStr = ymd(new Date());
        const today = buckets.find(b => b.date === todayStr);
        expect(today?.count).toBe(1);
    });
});
