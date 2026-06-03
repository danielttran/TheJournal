import type { DBManager } from './db';
import { advanceDueAt, type RecurInterval } from './recurring';

export type ReminderFilter = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed' | 'tasks';

/**
 * Pure SQL-fragment builder for {@link listReminders}. Extracted so the
 * filter semantics can be unit-tested without a database.
 *
 * Active-style filters (today/upcoming/overdue) exclude reminders that have
 * reached a terminal status (canceled/skipped/missed) so a skipped task no
 * longer shows as "overdue".
 */
export function buildReminderWhere(filter: ReminderFilter): string {
    const notTerminal = `Status NOT IN ('canceled', 'skipped', 'missed')`;
    // DueAt is a full ISO-8601 instant (e.g. 2026-06-03T08:00:00.000Z). Compare
    // it against the current instant via datetime() on BOTH sides — datetime()
    // parses the 'T'/'Z' to a UTC 'YYYY-MM-DD HH:MM:SS' that string-compares
    // correctly. Comparing the raw ISO string against a bare date() (the old
    // bug) made a reminder due earlier *today* never count as overdue and wrongly
    // appear as upcoming. "today" buckets by the LOCAL calendar date of DueAt.
    switch (filter) {
        case 'today':
            return `UserID = ? AND IsComplete = 0 AND ${notTerminal} AND date(DueAt, 'localtime') = date('now', 'localtime')`;
        case 'upcoming':
            return `UserID = ? AND IsComplete = 0 AND ${notTerminal} AND datetime(DueAt) >= datetime('now')`;
        case 'overdue':
            return `UserID = ? AND IsComplete = 0 AND ${notTerminal} AND datetime(DueAt) < datetime('now')`;
        case 'completed':
            return `UserID = ? AND IsComplete = 1`;
        case 'tasks':
            return `UserID = ? AND ReminderType = 'Task' AND Status = 'active'`;
        case 'all':
        default:
            return `UserID = ?`;
    }
}

/** DavidRM-style reminder kinds. */
export type ReminderType = 'Appointment' | 'Event' | 'Task' | 'SpecialDay';
/** Task lifecycle status (DavidRM tasks: active/done/skipped/canceled/missed). */
export type ReminderStatus = 'active' | 'done' | 'skipped' | 'canceled' | 'missed';

export const REMINDER_TYPES: ReminderType[] = ['Appointment', 'Event', 'Task', 'SpecialDay'];
export const REMINDER_STATUSES: ReminderStatus[] = ['active', 'done', 'skipped', 'canceled', 'missed'];

export interface Reminder {
    ReminderID: number;
    UserID: number;
    Title: string;
    Notes: string | null;
    DueAt: string;
    IsComplete: number;
    CompletedAt: string | null;
    EntryID: number | null;
    CreatedAt: string;
    RecurInterval: RecurInterval | null;
    RecurEvery: number | null;
    ReminderType: ReminderType;
    Status: ReminderStatus;
    LeadMinutes: number;
}

export interface CreateReminderInput {
    title: string;
    notes?: string | null;
    dueAt: string; // ISO timestamp
    entryId?: number | null;
    recurInterval?: RecurInterval | null;
    recurEvery?: number | null;
    reminderType?: ReminderType;
    leadMinutes?: number;
}

export interface UpdateReminderInput {
    title?: string;
    notes?: string | null;
    dueAt?: string;
    entryId?: number | null;
    recurInterval?: RecurInterval | null;
    recurEvery?: number | null;
    reminderType?: ReminderType;
    status?: ReminderStatus;
    leadMinutes?: number;
}

export async function createReminder(
    dbm: DBManager,
    userId: number,
    input: CreateReminderInput
): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Reminder (UserID, Title, Notes, DueAt, EntryID, RecurInterval, RecurEvery, ReminderType, Status, LeadMinutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).run(
        userId, input.title, input.notes ?? null, input.dueAt, input.entryId ?? null,
        input.recurInterval ?? null, input.recurEvery ?? null,
        input.reminderType ?? 'Appointment', input.leadMinutes ?? 0
    );
    return r.lastInsertRowid;
}

async function assertOwnership(dbm: DBManager, userId: number, reminderId: number): Promise<void> {
    const owns = await dbm.prepare(
        `SELECT 1 FROM Reminder WHERE ReminderID = ? AND UserID = ?`
    ).get(reminderId, userId);
    if (!owns) throw new Error('Reminder not found or unauthorized');
}

export async function updateReminder(
    dbm: DBManager,
    userId: number,
    reminderId: number,
    input: UpdateReminderInput
): Promise<void> {
    await assertOwnership(dbm, userId, reminderId);
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    if (input.title !== undefined) { updates.push('Title = ?'); values.push(input.title); }
    if (input.notes !== undefined) { updates.push('Notes = ?'); values.push(input.notes); }
    if (input.dueAt !== undefined) { updates.push('DueAt = ?'); values.push(input.dueAt); }
    if (input.entryId !== undefined) { updates.push('EntryID = ?'); values.push(input.entryId); }
    if (input.recurInterval !== undefined) { updates.push('RecurInterval = ?'); values.push(input.recurInterval); }
    if (input.recurEvery !== undefined) { updates.push('RecurEvery = ?'); values.push(input.recurEvery); }
    if (input.reminderType !== undefined) { updates.push('ReminderType = ?'); values.push(input.reminderType); }
    if (input.status !== undefined) {
        updates.push('Status = ?'); values.push(input.status);
        updates.push('IsComplete = ?'); values.push(input.status === 'done' ? 1 : 0);
    }
    if (input.leadMinutes !== undefined) { updates.push('LeadMinutes = ?'); values.push(input.leadMinutes); }
    if (!updates.length) return;
    values.push(reminderId);
    await dbm.prepare(`UPDATE Reminder SET ${updates.join(', ')} WHERE ReminderID = ?`).run(...values);
}

export async function deleteReminder(dbm: DBManager, userId: number, reminderId: number): Promise<void> {
    await assertOwnership(dbm, userId, reminderId);
    await dbm.prepare('DELETE FROM Reminder WHERE ReminderID = ?').run(reminderId);
}

export async function toggleComplete(dbm: DBManager, userId: number, reminderId: number): Promise<void> {
    await assertOwnership(dbm, userId, reminderId);

    // Read + write inside ONE transaction so concurrent toggles can't observe a stale
    // RecurInterval and double-spawn next occurrences (the AsyncMutex in DBManager
    // serializes transactions, making this a true compare-and-swap).
    const tx = dbm.transaction(async () => {
        const row = await dbm.prepare(
            'SELECT IsComplete, DueAt, Title, Notes, EntryID, RecurInterval, RecurEvery, ReminderType, LeadMinutes FROM Reminder WHERE ReminderID = ?'
        ).get(reminderId) as {
            IsComplete: number; DueAt: string; Title: string; Notes: string | null;
            EntryID: number | null; RecurInterval: RecurInterval | null; RecurEvery: number | null;
            ReminderType: string | null; LeadMinutes: number | null;
        } | undefined;
        if (!row) return;

        if (row.IsComplete) {
            await dbm.prepare(
                `UPDATE Reminder SET IsComplete = 0, CompletedAt = NULL, Status = 'active' WHERE ReminderID = ?`
            ).run(reminderId);
            return;
        }

        await dbm.prepare(
            `UPDATE Reminder SET IsComplete = 1, CompletedAt = CURRENT_TIMESTAMP, Status = 'done', RecurInterval = NULL, RecurEvery = NULL WHERE ReminderID = ?`
        ).run(reminderId);

        if (row.RecurInterval && row.RecurEvery && row.RecurEvery >= 1) {
            const nextDue = advanceDueAt(row.DueAt, row.RecurInterval, row.RecurEvery);
            await dbm.prepare(
                `INSERT INTO Reminder (UserID, Title, Notes, DueAt, EntryID, RecurInterval, RecurEvery, ReminderType, Status, LeadMinutes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
            ).run(
                userId, row.Title, row.Notes, nextDue, row.EntryID,
                row.RecurInterval, row.RecurEvery,
                row.ReminderType ?? 'Appointment', row.LeadMinutes ?? 0
            );
        }
    });
    await tx();
}

export async function listReminders(
    dbm: DBManager,
    userId: number,
    filter: ReminderFilter = 'all'
): Promise<Reminder[]> {
    const where = buildReminderWhere(filter);
    const rows = await dbm.prepare(
        `SELECT * FROM Reminder WHERE ${where} ORDER BY DueAt ASC`
    ).all(userId) as Reminder[];
    return rows;
}
