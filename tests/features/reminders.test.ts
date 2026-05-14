/**
 * Feature: Reminders / Tasks
 *  - Reminder table with id, userId, title, notes, dueAt, isComplete, entryId, createdAt
 *  - CRUD: createReminder, updateReminder, deleteReminder
 *  - listReminders(userId, filter?) — returns reminders filtered by 'all'|'today'|'upcoming'|'overdue'|'completed'
 *  - toggleComplete(id) flips isComplete and stamps CompletedAt
 *  - Authorization: only the owning user can touch their reminders
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    createReminder,
    updateReminder,
    deleteReminder,
    toggleComplete,
    listReminders,
} from '../../src/lib/reminders';

const TEST_DB_PATH = join(process.cwd(), `test-rem-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'rem-user');
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

const dueIso = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
};

describe('Reminders — schema', () => {
    it('Reminder table exists with the required columns', async () => {
        const cols = await dbm.prepare(`PRAGMA table_info(Reminder)`).all() as { name: string }[];
        const names = new Set(cols.map(c => c.name));
        for (const required of ['ReminderID', 'UserID', 'Title', 'Notes', 'DueAt', 'IsComplete', 'CompletedAt', 'EntryID', 'CreatedAt']) {
            expect(names.has(required), `missing column ${required}`).toBe(true);
        }
    });
});

describe('Reminders — CRUD', () => {
    it('creates a reminder and returns its id', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 'Buy milk', dueAt: dueIso(1) });
        expect(id).toBeGreaterThan(0);
        const row = await dbm.prepare('SELECT Title FROM Reminder WHERE ReminderID = ?').get(id) as any;
        expect(row.Title).toBe('Buy milk');
    });

    it('updates a reminder', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 'Old', dueAt: dueIso(1) });
        await updateReminder(dbm, USER_ID, id, { title: 'New', notes: 'note' });
        const row = await dbm.prepare('SELECT Title, Notes FROM Reminder WHERE ReminderID = ?').get(id) as any;
        expect(row.Title).toBe('New');
        expect(row.Notes).toBe('note');
    });

    it('deletes a reminder', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 'gone', dueAt: dueIso(0) });
        await deleteReminder(dbm, USER_ID, id);
        const row = await dbm.prepare('SELECT 1 FROM Reminder WHERE ReminderID = ?').get(id);
        expect(row).toBeUndefined();
    });

    it('refuses cross-user mutations', async () => {
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'attacker');
        const id = await createReminder(dbm, USER_ID, { title: 'victim', dueAt: dueIso(1) });
        await expect(updateReminder(dbm, 99, id, { title: 'pwned' })).rejects.toThrow();
        await expect(deleteReminder(dbm, 99, id)).rejects.toThrow();
    });
});

describe('Reminders — completion', () => {
    it('toggles IsComplete on, sets CompletedAt', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 't', dueAt: dueIso(1) });
        await toggleComplete(dbm, USER_ID, id);
        const row = await dbm.prepare('SELECT IsComplete, CompletedAt FROM Reminder WHERE ReminderID = ?').get(id) as any;
        expect(row.IsComplete).toBe(1);
        expect(row.CompletedAt).toBeTruthy();
    });

    it('toggles back to incomplete, clears CompletedAt', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 't', dueAt: dueIso(1) });
        await toggleComplete(dbm, USER_ID, id);
        await toggleComplete(dbm, USER_ID, id);
        const row = await dbm.prepare('SELECT IsComplete, CompletedAt FROM Reminder WHERE ReminderID = ?').get(id) as any;
        expect(row.IsComplete).toBe(0);
        expect(row.CompletedAt).toBeNull();
    });
});

describe('Reminders — listing & filters', () => {
    it('list "all" returns all of user\'s reminders', async () => {
        await createReminder(dbm, USER_ID, { title: 'a', dueAt: dueIso(-1) });
        await createReminder(dbm, USER_ID, { title: 'b', dueAt: dueIso(1) });
        const r = await listReminders(dbm, USER_ID, 'all');
        expect(r.length).toBe(2);
    });

    it('list "overdue" returns only past, incomplete reminders', async () => {
        await createReminder(dbm, USER_ID, { title: 'past', dueAt: dueIso(-2) });
        await createReminder(dbm, USER_ID, { title: 'future', dueAt: dueIso(5) });
        const completedId = await createReminder(dbm, USER_ID, { title: 'past-done', dueAt: dueIso(-3) });
        await toggleComplete(dbm, USER_ID, completedId);

        const r = await listReminders(dbm, USER_ID, 'overdue');
        const titles = r.map(x => x.Title);
        expect(titles).toContain('past');
        expect(titles).not.toContain('future');
        expect(titles).not.toContain('past-done');
    });

    it('list "today" returns only reminders due today', async () => {
        const today = new Date();
        today.setHours(15, 0, 0, 0);
        await createReminder(dbm, USER_ID, { title: 'today', dueAt: today.toISOString() });
        await createReminder(dbm, USER_ID, { title: 'tomorrow', dueAt: dueIso(1) });
        const r = await listReminders(dbm, USER_ID, 'today');
        const titles = r.map(x => x.Title);
        expect(titles).toContain('today');
        expect(titles).not.toContain('tomorrow');
    });

    it('list "upcoming" returns only future reminders (including today)', async () => {
        await createReminder(dbm, USER_ID, { title: 'past', dueAt: dueIso(-3) });
        await createReminder(dbm, USER_ID, { title: 'soon', dueAt: dueIso(2) });
        const r = await listReminders(dbm, USER_ID, 'upcoming');
        const titles = r.map(x => x.Title);
        expect(titles).toContain('soon');
        expect(titles).not.toContain('past');
    });

    it('list "completed" returns only completed reminders', async () => {
        const a = await createReminder(dbm, USER_ID, { title: 'a', dueAt: dueIso(0) });
        await createReminder(dbm, USER_ID, { title: 'b', dueAt: dueIso(0) });
        await toggleComplete(dbm, USER_ID, a);

        const r = await listReminders(dbm, USER_ID, 'completed');
        expect(r.length).toBe(1);
        expect(r[0].Title).toBe('a');
    });

    it('only lists reminders for the requesting user', async () => {
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'other');
        await createReminder(dbm, 99, { title: 'theirs', dueAt: dueIso(1) });
        await createReminder(dbm, USER_ID, { title: 'mine', dueAt: dueIso(1) });

        const r = await listReminders(dbm, USER_ID, 'all');
        expect(r.map(x => x.Title)).toEqual(['mine']);
    });
});
