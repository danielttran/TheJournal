import type { DBManager } from './db';

export interface FutureReminderInput {
    entryId: number;
    title: string;
    dueAt: string;        // ISO 8601
    nowIso: string;       // ISO 8601 — caller controls the clock
    notes?: string;
}

/**
 * When the user saves a future-dated entry, surface it as a reminder so the
 * popup wakes them at the appointed time. DavidRM parity: "scheduled
 * entries as future reminders to yourself".
 *
 * - Returns the ReminderID (newly created OR pre-existing for this entry).
 * - Returns null when `dueAt` is not strictly after `nowIso` — we don't
 *   spawn stale reminders for back-dated entries.
 * - Idempotent: a second call with the same entryId reuses the prior
 *   reminder instead of cluttering the reminder list.
 */
export async function linkEntryAsFutureReminder(
    dbm: DBManager,
    userId: number,
    input: FutureReminderInput,
): Promise<number | null> {
    if (new Date(input.dueAt).getTime() <= new Date(input.nowIso).getTime()) {
        return null;
    }

    const existing = await dbm.prepare(`
        SELECT ReminderID FROM Reminder
        WHERE UserID = ? AND EntryID = ? AND ReminderType = 'Event'
        ORDER BY ReminderID DESC LIMIT 1
    `).get(userId, input.entryId) as { ReminderID: number } | undefined;

    if (existing) {
        // Keep the title/notes/DueAt aligned with the entry's latest state.
        await dbm.prepare(`
            UPDATE Reminder
            SET Title = ?, Notes = ?, DueAt = ?
            WHERE ReminderID = ? AND UserID = ?
        `).run(input.title, input.notes ?? null, input.dueAt, existing.ReminderID, userId);
        return existing.ReminderID;
    }

    const res = await dbm.prepare(`
        INSERT INTO Reminder
            (UserID, Title, Notes, DueAt, EntryID, ReminderType, Status, LeadMinutes)
        VALUES (?, ?, ?, ?, ?, 'Event', 'active', 0)
    `).run(userId, input.title, input.notes ?? null, input.dueAt, input.entryId);

    return Number(res.lastInsertRowid);
}
