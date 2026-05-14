/**
 * Feature: Statistics
 *  - totalEntries(userId), totalWords(userId)
 *  - entriesPerDay(userId, days): array of { date: 'YYYY-MM-DD', count, words } for last N days
 *  - longestStreak(userId): longest consecutive-day streak of entries
 *  - currentStreak(userId): consecutive days ending today (or yesterday) with an entry
 *  - topTags(userId, limit)
 *  - topMoods(userId, limit)
 *  - Excludes soft-deleted entries
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    totalEntries,
    totalWords,
    entriesPerDay,
    longestStreak,
    currentStreak,
    topTags,
    topMoods,
} from '../../src/lib/stats';

const TEST_DB_PATH = join(process.cwd(), `test-stats-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

const isoDate = (offsetDays: number) => {
    // Build a LOCAL YYYY-MM-DD so the inserted CreatedDate's local-time date
    // matches the "today/yesterday" the streak tests reason about. Using
    // `toISOString()` here returns UTC, which shifts the day after UTC midnight
    // in local-evening test runs.
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day} 12:00:00`;
};

async function entry(html: string, offsetDays: number, opts: { tags?: string[]; mood?: string; isDeleted?: boolean } = {}) {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate, Tags, Mood, IsDeleted) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(categoryId, 't', '', isoDate(offsetDays), JSON.stringify(opts.tags ?? []), opts.mood ?? null, opts.isDeleted ? 1 : 0);
    await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(r.lastInsertRowid, html);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'st-user');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'S', 'Journal');
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

describe('Stats — counts', () => {
    it('totalEntries excludes deleted', async () => {
        await entry('<p>a</p>', 0);
        await entry('<p>b</p>', -1);
        await entry('<p>gone</p>', -2, { isDeleted: true });
        expect(await totalEntries(dbm, USER_ID)).toBe(2);
    });

    it('totalWords sums stripped words', async () => {
        await entry('<p>one two</p>', 0);
        await entry('<p>three four five</p>', -1);
        expect(await totalWords(dbm, USER_ID)).toBe(5);
    });
});

describe('Stats — per-day series', () => {
    it('returns one row per day with counts and words for last N days', async () => {
        await entry('<p>hello</p>', 0);     // today
        await entry('<p>world today</p>', 0);
        await entry('<p>yesterday post</p>', -1);

        const series = await entriesPerDay(dbm, USER_ID, 7);
        expect(series.length).toBe(7);
        // Local-date today, to align with isoDate(0) which now produces local dates.
        const n = new Date();
        const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
        const todayRow = series.find(s => s.date === today);
        expect(todayRow?.count).toBe(2);
        expect(todayRow?.words).toBe(3); // hello + world + today
    });
});

describe('Stats — streaks', () => {
    it('longestStreak finds longest consecutive run', async () => {
        // Entries on day -1, -2, -3 (3-day streak), and day -10 (1-day run)
        await entry('<p>x</p>', -1);
        await entry('<p>x</p>', -2);
        await entry('<p>x</p>', -3);
        await entry('<p>x</p>', -10);
        expect(await longestStreak(dbm, USER_ID)).toBe(3);
    });

    it('currentStreak counts streak ending today/yesterday', async () => {
        await entry('<p>x</p>', 0);  // today
        await entry('<p>x</p>', -1); // yesterday
        await entry('<p>x</p>', -2);
        expect(await currentStreak(dbm, USER_ID)).toBe(3);
    });

    it('currentStreak is 0 if no entry today or yesterday', async () => {
        await entry('<p>x</p>', -3);
        await entry('<p>x</p>', -4);
        expect(await currentStreak(dbm, USER_ID)).toBe(0);
    });
});

describe('Stats — top tags / moods', () => {
    it('topTags counts each tag across entries', async () => {
        await entry('<p>x</p>', 0, { tags: ['work', 'travel'] });
        await entry('<p>x</p>', -1, { tags: ['work'] });
        await entry('<p>x</p>', -2, { tags: ['travel', 'food'] });

        const tags = await topTags(dbm, USER_ID, 10);
        const map = new Map(tags.map(t => [t.tag, t.count]));
        expect(map.get('work')).toBe(2);
        expect(map.get('travel')).toBe(2);
        expect(map.get('food')).toBe(1);
    });

    it('topMoods counts each mood', async () => {
        await entry('<p>x</p>', 0, { mood: 'happy' });
        await entry('<p>x</p>', -1, { mood: 'happy' });
        await entry('<p>x</p>', -2, { mood: 'sad' });
        const moods = await topMoods(dbm, USER_ID, 5);
        const map = new Map(moods.map(m => [m.mood, m.count]));
        expect(map.get('happy')).toBe(2);
        expect(map.get('sad')).toBe(1);
    });
});
