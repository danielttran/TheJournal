/**
 * Reminder snooze.
 *  - snoozeReminder(userId, id, minutes) shifts DueAt forward
 *  - Refuses to snooze a completed reminder (no-op or throws)
 *  - Recurrence settings preserved
 *  - Cross-user mutation rejected
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { createReminder, toggleComplete } from '../../src/lib/reminders';
import { snoozeReminder } from '../../src/lib/reminderSnooze';

const TEST_DB_PATH = join(process.cwd(), `test-snooze-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 's');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'o');
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

describe('snoozeReminder', () => {
    it('shifts DueAt forward by N minutes', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 'x', dueAt: '2026-05-13T08:00:00.000Z' });
        await snoozeReminder(dbm, USER_ID, id, 30);
        const row = await dbm.prepare('SELECT DueAt FROM Reminder WHERE ReminderID = ?').get(id) as { DueAt: string };
        expect(row.DueAt).toBe('2026-05-13T08:30:00.000Z');
    });

    it('handles larger snooze values', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 'x', dueAt: '2026-05-13T08:00:00.000Z' });
        await snoozeReminder(dbm, USER_ID, id, 60 * 24); // one day
        const row = await dbm.prepare('SELECT DueAt FROM Reminder WHERE ReminderID = ?').get(id) as { DueAt: string };
        expect(row.DueAt).toBe('2026-05-14T08:00:00.000Z');
    });

    it('clears NotifiedAt so the reminder fires again at the new time', async () => {
        // Regression: a reminder that already notified would be excluded forever
        // (findDueReminders filters NotifiedAt IS NULL), making snooze a no-op.
        const id = await createReminder(dbm, USER_ID, { title: 'x', dueAt: '2026-05-13T08:00:00.000Z' });
        await dbm.prepare('UPDATE Reminder SET NotifiedAt = ? WHERE ReminderID = ?').run('2026-05-13T08:00:00.000Z', id);
        await snoozeReminder(dbm, USER_ID, id, 30);
        const row = await dbm.prepare('SELECT NotifiedAt FROM Reminder WHERE ReminderID = ?').get(id) as { NotifiedAt: string | null };
        expect(row.NotifiedAt).toBeNull();
    });

    it('preserves recurrence settings', async () => {
        const id = await createReminder(dbm, USER_ID, {
            title: 'r', dueAt: '2026-05-13T08:00:00.000Z',
            recurInterval: 'weekly', recurEvery: 2,
        });
        await snoozeReminder(dbm, USER_ID, id, 60);
        const row = await dbm.prepare(
            `SELECT RecurInterval, RecurEvery FROM Reminder WHERE ReminderID = ?`
        ).get(id) as { RecurInterval: string; RecurEvery: number };
        expect(row.RecurInterval).toBe('weekly');
        expect(row.RecurEvery).toBe(2);
    });

    it('refuses to snooze a completed reminder', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 'done', dueAt: '2026-05-13T08:00:00.000Z' });
        await toggleComplete(dbm, USER_ID, id);
        await expect(snoozeReminder(dbm, USER_ID, id, 30)).rejects.toThrow();
    });

    it('refuses cross-user snooze', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 'mine', dueAt: '2026-05-13T08:00:00.000Z' });
        await expect(snoozeReminder(dbm, 99, id, 30)).rejects.toThrow();
    });

    it('rejects non-positive minutes', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 'x', dueAt: '2026-05-13T08:00:00.000Z' });
        await expect(snoozeReminder(dbm, USER_ID, id, 0)).rejects.toThrow();
        await expect(snoozeReminder(dbm, USER_ID, id, -10)).rejects.toThrow();
    });
});
