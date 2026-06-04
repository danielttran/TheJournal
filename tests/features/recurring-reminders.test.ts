/**
 * Feature: Recurring reminders
 *  - Reminder has RecurInterval (daily/weekly/monthly/yearly | null) + RecurEvery (int >= 1)
 *  - advanceDueAt(date, interval, every) computes the next occurrence
 *  - toggleComplete on a recurring reminder creates the next occurrence + marks current done
 *  - Non-recurring reminders behave as before (just toggle complete)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { advanceDueAt, type RecurInterval } from '../../src/lib/recurring';
import { createReminder, toggleComplete } from '../../src/lib/reminders';

const TEST_DB_PATH = join(process.cwd(), `test-recur-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'r');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Reminder').run();
});

describe('advanceDueAt', () => {
    const cases: [string, RecurInterval, number, string][] = [
        ['2026-05-13T12:00:00Z', 'daily', 1, '2026-05-14T12:00:00.000Z'],
        ['2026-05-13T12:00:00Z', 'daily', 3, '2026-05-16T12:00:00.000Z'],
        ['2026-05-13T12:00:00Z', 'weekly', 1, '2026-05-20T12:00:00.000Z'],
        ['2026-05-13T12:00:00Z', 'weekly', 2, '2026-05-27T12:00:00.000Z'],
        ['2026-05-13T12:00:00Z', 'monthly', 1, '2026-06-13T12:00:00.000Z'],
        ['2026-12-31T12:00:00Z', 'monthly', 1, '2027-01-31T12:00:00.000Z'],
        ['2026-01-31T12:00:00Z', 'monthly', 1, '2026-02-28T12:00:00.000Z'], // clamps to end of Feb
        ['2026-05-13T12:00:00Z', 'yearly', 1, '2027-05-13T12:00:00.000Z'],
        ['2024-02-29T12:00:00Z', 'yearly', 1, '2025-02-28T12:00:00.000Z'], // leap → clamps
    ];

    cases.forEach(([from, interval, every, expected]) => {
        it(`${from} + ${every}x ${interval} → ${expected}`, () => {
            const got = advanceDueAt(from, interval, every);
            expect(got).toBe(expected);
        });
    });
});

describe('Recurring reminders DB integration', () => {
    it('schema includes RecurInterval + RecurEvery', async () => {
        const cols = await dbm.prepare(`PRAGMA table_info(Reminder)`).all() as { name: string }[];
        const names = new Set(cols.map(c => c.name));
        expect(names.has('RecurInterval')).toBe(true);
        expect(names.has('RecurEvery')).toBe(true);
    });

    it('toggleComplete on a recurring reminder creates the next occurrence', async () => {
        const id = await createReminder(dbm, USER_ID, {
            title: 'water plants',
            dueAt: '2026-05-13T08:00:00.000Z',
            recurInterval: 'daily',
            recurEvery: 1,
        });
        await toggleComplete(dbm, USER_ID, id);

        const all = await dbm.prepare('SELECT * FROM Reminder ORDER BY ReminderID').all() as any[];
        expect(all.length).toBe(2);
        const [completed, next] = all;
        expect(completed.IsComplete).toBe(1);
        // Recurrence is PRESERVED on the completed instance so un-completing can
        // reverse it; the spawned occurrence is linked via NextOccurrenceID.
        expect(completed.RecurInterval).toBe('daily');
        expect(completed.NextOccurrenceID).toBe(next.ReminderID);
        expect(next.IsComplete).toBe(0);
        expect(next.RecurInterval).toBe('daily');
        expect(next.DueAt).toBe('2026-05-14T08:00:00.000Z');
        expect(next.Title).toBe('water plants');
    });

    it('un-completing a recurring reminder deletes the spawned occurrence (no duplicate, recurrence intact)', async () => {
        const id = await createReminder(dbm, USER_ID, {
            title: 'standup', dueAt: '2026-06-01T09:00:00.000Z', recurInterval: 'daily', recurEvery: 1,
        });
        await toggleComplete(dbm, USER_ID, id);       // spawns Jun 2 occurrence
        expect((await dbm.prepare('SELECT COUNT(*) AS n FROM Reminder').get() as any).n).toBe(2);

        await toggleComplete(dbm, USER_ID, id);       // un-complete → remove the spawn
        const rows = await dbm.prepare('SELECT * FROM Reminder').all() as any[];
        expect(rows.length).toBe(1);                  // duplicate is gone
        expect(rows[0].ReminderID).toBe(id);
        expect(rows[0].IsComplete).toBe(0);
        expect(rows[0].RecurInterval).toBe('daily');  // recurrence restored
        expect(rows[0].NextOccurrenceID).toBeNull();
    });

    it('toggleComplete on a non-recurring reminder does NOT spawn a new one', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 'one-off', dueAt: '2026-05-13T08:00:00.000Z' });
        await toggleComplete(dbm, USER_ID, id);
        const all = await dbm.prepare('SELECT * FROM Reminder').all() as any[];
        expect(all.length).toBe(1);
        expect(all[0].IsComplete).toBe(1);
    });

    it('toggling complete twice on a recurring reminder un-completes the original (no third occurrence)', async () => {
        const id = await createReminder(dbm, USER_ID, {
            title: 'gym',
            dueAt: '2026-05-13T08:00:00.000Z',
            recurInterval: 'weekly',
            recurEvery: 1,
        });
        await toggleComplete(dbm, USER_ID, id);
        const afterFirst = await dbm.prepare('SELECT COUNT(*) AS n FROM Reminder').get() as any;
        expect(afterFirst.n).toBe(2);

        // Toggle the original back to incomplete — the spawned occurrence is
        // removed, leaving just the original (no third occurrence, no duplicate).
        await toggleComplete(dbm, USER_ID, id);
        const afterSecond = await dbm.prepare('SELECT COUNT(*) AS n FROM Reminder').get() as any;
        expect(afterSecond.n).toBe(1);
    });
});
