/**
 * M2 — Desktop notifications + future-dated entries as reminders.
 *
 * Two new helpers in src/lib/reminderNotifications.ts:
 *  - findDueReminders(dbm, userId, nowIso): returns reminders whose
 *    notify-time (DueAt − LeadMinutes) has passed, that are still active /
 *    not yet complete, and that haven't already been notified.
 *  - markReminderNotified(dbm, userId, reminderId): stamps NotifiedAt so a
 *    re-poll doesn't fire the same alert twice.
 *
 * One new helper in src/lib/futureEntries.ts:
 *  - linkEntryAsFutureReminder(dbm, userId, entryId, dueAt, title): if
 *    `dueAt` is strictly in the future relative to `nowIso`, create an
 *    Event-type reminder linked to that entry. Otherwise no-op (so saving
 *    a back-dated entry never spawns a stale reminder).
 *
 * The renderer polls findDueReminders every minute and the Electron main
 * process fires a fallback Notification when the renderer is hidden.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    findDueReminders,
    markReminderNotified,
} from '../../src/lib/reminderNotifications';
import { linkEntryAsFutureReminder } from '../../src/lib/futureEntries';

const TEST_DB_PATH = join(process.cwd(), `test-m2-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let CAT_ID = 0;

const isoMinutesAhead = (mins: number, base = new Date()) => {
    const d = new Date(base.getTime() + mins * 60_000);
    return d.toISOString();
};

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'm2-user');
    const cat = await dbm.prepare(
        `INSERT INTO Category (UserID, Name, Type) VALUES (?, 'Cal', 'Journal')`
    ).run(USER_ID);
    CAT_ID = Number(cat.lastInsertRowid);
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Reminder').run();
    await dbm.prepare('DELETE FROM Entry').run();
});

describe('Reminder schema — NotifiedAt column', () => {
    it('Reminder has a NotifiedAt column for de-duping notifications', async () => {
        const cols = await dbm.prepare(`PRAGMA table_info(Reminder)`).all() as { name: string }[];
        expect(cols.find(c => c.name === 'NotifiedAt'), 'NotifiedAt column missing').toBeDefined();
    });
});

describe('findDueReminders', () => {
    it('returns reminders whose DueAt has just passed', async () => {
        const now = new Date();
        const past = isoMinutesAhead(-1, now);
        await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status, LeadMinutes) VALUES (?, 'past', ?, 'Appointment', 'active', 0)`
        ).run(USER_ID, past);
        const due = await findDueReminders(dbm, USER_ID, now.toISOString());
        expect(due.map(r => r.Title)).toContain('past');
    });

    it('respects LeadMinutes — alerts fire BEFORE DueAt', async () => {
        const now = new Date();
        // DueAt is 5 minutes ahead, LeadMinutes is 10 → effective notify time is 5 min ago.
        const due = isoMinutesAhead(5, now);
        await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status, LeadMinutes) VALUES (?, 'lead', ?, 'Appointment', 'active', 10)`
        ).run(USER_ID, due);
        const out = await findDueReminders(dbm, USER_ID, now.toISOString());
        expect(out.map(r => r.Title)).toContain('lead');
    });

    it('does not return reminders whose notify-time is in the future', async () => {
        const now = new Date();
        const future = isoMinutesAhead(60, now);
        await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status, LeadMinutes) VALUES (?, 'future', ?, 'Appointment', 'active', 0)`
        ).run(USER_ID, future);
        const out = await findDueReminders(dbm, USER_ID, now.toISOString());
        expect(out.map(r => r.Title)).not.toContain('future');
    });

    it('omits already-notified reminders (NotifiedAt set)', async () => {
        const now = new Date();
        const past = isoMinutesAhead(-1, now);
        const r = await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status, LeadMinutes, NotifiedAt)
             VALUES (?, 'already', ?, 'Appointment', 'active', 0, ?)`
        ).run(USER_ID, past, now.toISOString());
        expect(Number(r.lastInsertRowid)).toBeGreaterThan(0);
        const out = await findDueReminders(dbm, USER_ID, now.toISOString());
        expect(out.map(r => r.Title)).not.toContain('already');
    });

    it('omits completed and terminal-status reminders', async () => {
        const now = new Date();
        const past = isoMinutesAhead(-1, now);
        await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status, IsComplete) VALUES (?, 'done', ?, 'Task', 'done', 1)`
        ).run(USER_ID, past);
        await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status) VALUES (?, 'canceled', ?, 'Task', 'canceled')`
        ).run(USER_ID, past);
        await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status) VALUES (?, 'skipped', ?, 'Task', 'skipped')`
        ).run(USER_ID, past);
        const out = await findDueReminders(dbm, USER_ID, now.toISOString());
        expect(out.length).toBe(0);
    });

    it('scopes to the calling user', async () => {
        const now = new Date();
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (2, ?)').run('other');
        await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status, LeadMinutes) VALUES (?, 'mine', ?, 'Appointment', 'active', 0)`
        ).run(USER_ID, isoMinutesAhead(-1, now));
        await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status, LeadMinutes) VALUES (2, 'theirs', ?, 'Appointment', 'active', 0)`
        ).run(isoMinutesAhead(-1, now));
        const out = await findDueReminders(dbm, USER_ID, now.toISOString());
        expect(out.map(r => r.Title)).toEqual(['mine']);
    });
});

describe('markReminderNotified', () => {
    it('sets NotifiedAt so the next poll skips this reminder', async () => {
        const now = new Date();
        const r = await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status) VALUES (?, 't', ?, 'Appointment', 'active')`
        ).run(USER_ID, isoMinutesAhead(-1, now));
        await markReminderNotified(dbm, USER_ID, Number(r.lastInsertRowid), now.toISOString());
        const out = await findDueReminders(dbm, USER_ID, now.toISOString());
        expect(out.length).toBe(0);
    });

    it('refuses to mark a reminder belonging to another user', async () => {
        const now = new Date();
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (3, ?)').run('foreign');
        const r = await dbm.prepare(
            `INSERT INTO Reminder (UserID, Title, DueAt, ReminderType, Status) VALUES (3, 'theirs', ?, 'Appointment', 'active')`
        ).run(isoMinutesAhead(-1, now));
        const wrote = await markReminderNotified(dbm, USER_ID, Number(r.lastInsertRowid), now.toISOString());
        expect(wrote).toBe(false);
        const stillUnnotified = await findDueReminders(dbm, 3, now.toISOString());
        expect(stillUnnotified.length).toBe(1);
    });
});

describe('linkEntryAsFutureReminder', () => {
    it('creates an Event reminder when DueAt is in the future', async () => {
        const e = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title) VALUES (?, 'Future Event')`
        ).run(CAT_ID);
        const entryId = Number(e.lastInsertRowid);
        const due = isoMinutesAhead(60);
        const id = await linkEntryAsFutureReminder(dbm, USER_ID, {
            entryId,
            title: 'Future Event',
            dueAt: due,
            nowIso: new Date().toISOString(),
        });
        expect(id).toBeGreaterThan(0);
        const row = await dbm.prepare(
            'SELECT ReminderType, EntryID, Title FROM Reminder WHERE ReminderID = ?'
        ).get(id) as { ReminderType: string; EntryID: number; Title: string };
        expect(row.ReminderType).toBe('Event');
        expect(row.EntryID).toBe(entryId);
        expect(row.Title).toBe('Future Event');
    });

    it('returns null and creates nothing for entries dated now or in the past', async () => {
        const e = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title) VALUES (?, 'Old')`
        ).run(CAT_ID);
        const entryId = Number(e.lastInsertRowid);
        const out = await linkEntryAsFutureReminder(dbm, USER_ID, {
            entryId,
            title: 'Old',
            dueAt: isoMinutesAhead(-1),
            nowIso: new Date().toISOString(),
        });
        expect(out).toBeNull();
        const count = await dbm.prepare('SELECT COUNT(*) AS n FROM Reminder').get() as { n: number };
        expect(count.n).toBe(0);
    });

    it('does not duplicate when called twice for the same entry/dueAt', async () => {
        const e = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title) VALUES (?, 'Once')`
        ).run(CAT_ID);
        const entryId = Number(e.lastInsertRowid);
        const due = isoMinutesAhead(30);
        const a = await linkEntryAsFutureReminder(dbm, USER_ID, {
            entryId, title: 'Once', dueAt: due, nowIso: new Date().toISOString(),
        });
        const b = await linkEntryAsFutureReminder(dbm, USER_ID, {
            entryId, title: 'Once', dueAt: due, nowIso: new Date().toISOString(),
        });
        expect(a).toBeGreaterThan(0);
        expect(b).toBe(a); // same reminder returned, not a new one
        const count = await dbm.prepare(
            'SELECT COUNT(*) AS n FROM Reminder WHERE EntryID = ?'
        ).get(entryId) as { n: number };
        expect(count.n).toBe(1);
    });
});
