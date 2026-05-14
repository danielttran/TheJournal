/**
 * Habit tracker.
 *  - Habit + HabitLog tables
 *  - createHabit / listHabits / deleteHabit
 *  - logHabit(habitId, date) / unlogHabit(habitId, date)
 *  - getHabitStatus(habitId, dateRange) returns {date, logged} for each day
 *  - habitStreak(habitId): {current, longest}
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    createHabit, listHabits, deleteHabit,
    logHabit, unlogHabit, getHabitStatus, habitStreak,
} from '../../src/lib/habits';

const TEST_DB_PATH = join(process.cwd(), `test-habit-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'h');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'o');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Habit WHERE UserID IN (?, ?)').run(USER_ID, 99);
});

describe('Habit CRUD', () => {
    it('create + list + delete', async () => {
        const id = await createHabit(dbm, USER_ID, { name: 'Read', color: '#10b981' });
        const list = await listHabits(dbm, USER_ID);
        expect(list.length).toBe(1);
        expect(list[0].Name).toBe('Read');

        await deleteHabit(dbm, USER_ID, id);
        expect((await listHabits(dbm, USER_ID)).length).toBe(0);
    });

    it('refuses cross-user delete', async () => {
        const id = await createHabit(dbm, USER_ID, { name: 'mine' });
        await deleteHabit(dbm, 99, id);
        expect((await listHabits(dbm, USER_ID)).length).toBe(1);
    });
});

describe('HabitLog', () => {
    it('logHabit + unlogHabit toggle a date', async () => {
        const id = await createHabit(dbm, USER_ID, { name: 'Read' });
        await logHabit(dbm, USER_ID, id, '2026-05-13');
        let status = await getHabitStatus(dbm, USER_ID, id, '2026-05-12', '2026-05-14');
        expect(status.find(s => s.date === '2026-05-13')?.logged).toBe(true);
        expect(status.find(s => s.date === '2026-05-12')?.logged).toBe(false);

        await unlogHabit(dbm, USER_ID, id, '2026-05-13');
        status = await getHabitStatus(dbm, USER_ID, id, '2026-05-12', '2026-05-14');
        expect(status.find(s => s.date === '2026-05-13')?.logged).toBe(false);
    });

    it('logHabit is idempotent (same date twice = still one log)', async () => {
        const id = await createHabit(dbm, USER_ID, { name: 'Read' });
        await logHabit(dbm, USER_ID, id, '2026-05-13');
        await logHabit(dbm, USER_ID, id, '2026-05-13');
        const rows = await dbm.prepare(`SELECT COUNT(*) AS n FROM HabitLog WHERE HabitID = ?`).get(id) as { n: number };
        expect(rows.n).toBe(1);
    });

    it('refuses cross-user log', async () => {
        const id = await createHabit(dbm, USER_ID, { name: 'mine' });
        await expect(logHabit(dbm, 99, id, '2026-05-13')).rejects.toThrow();
    });

    it('getHabitStatus returns a row for every date in range, in order', async () => {
        const id = await createHabit(dbm, USER_ID, { name: 'Read' });
        await logHabit(dbm, USER_ID, id, '2026-05-11');
        await logHabit(dbm, USER_ID, id, '2026-05-13');
        const status = await getHabitStatus(dbm, USER_ID, id, '2026-05-10', '2026-05-13');
        expect(status.map(s => s.date)).toEqual(['2026-05-10', '2026-05-11', '2026-05-12', '2026-05-13']);
        expect(status.map(s => s.logged)).toEqual([false, true, false, true]);
    });
});

describe('habitStreak', () => {
    it('returns 0/0 when never logged', async () => {
        const id = await createHabit(dbm, USER_ID, { name: 'Read' });
        const s = await habitStreak(dbm, USER_ID, id);
        expect(s).toEqual({ current: 0, longest: 0 });
    });

    it('counts consecutive days for longest streak', async () => {
        const id = await createHabit(dbm, USER_ID, { name: 'Read' });
        for (const d of ['2026-05-10', '2026-05-11', '2026-05-12', '2026-05-15', '2026-05-16']) {
            await logHabit(dbm, USER_ID, id, d);
        }
        const s = await habitStreak(dbm, USER_ID, id);
        expect(s.longest).toBe(3);
    });

    it('current streak ends today (or yesterday if today not logged)', async () => {
        const id = await createHabit(dbm, USER_ID, { name: 'Read' });
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const day = (offset: number) => {
            const x = new Date(today); x.setDate(x.getDate() + offset); return fmt(x);
        };
        await logHabit(dbm, USER_ID, id, day(0));
        await logHabit(dbm, USER_ID, id, day(-1));
        await logHabit(dbm, USER_ID, id, day(-2));
        const s = await habitStreak(dbm, USER_ID, id);
        expect(s.current).toBe(3);
    });

    it('current streak is 0 if no log today/yesterday', async () => {
        const id = await createHabit(dbm, USER_ID, { name: 'Read' });
        await logHabit(dbm, USER_ID, id, '2024-01-01');
        const s = await habitStreak(dbm, USER_ID, id);
        expect(s.current).toBe(0);
    });
});
