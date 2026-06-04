import type { DBManager } from './db';

/**
 * Push a reminder's DueAt forward by `minutes`. Throws on:
 *   - non-positive minutes
 *   - reminder not owned by user
 *   - reminder already completed (snoozing finished tasks makes no sense)
 */
export async function snoozeReminder(
    dbm: DBManager,
    userId: number,
    reminderId: number,
    minutes: number
): Promise<void> {
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('minutes must be a positive number');
    if (minutes > 60 * 24 * 365) throw new Error('snooze cap is 1 year');

    const row = await dbm.prepare(
        `SELECT DueAt, IsComplete FROM Reminder WHERE ReminderID = ? AND UserID = ?`
    ).get(reminderId, userId) as { DueAt: string; IsComplete: number } | undefined;
    if (!row) throw new Error('Reminder not found or unauthorized');
    if (row.IsComplete) throw new Error('Cannot snooze a completed reminder');

    const newDue = new Date(new Date(row.DueAt).getTime() + minutes * 60_000).toISOString();
    // Clear NotifiedAt so the reminder fires again at the new time. Without this,
    // a reminder that already notified would be excluded forever by
    // findDueReminders (NotifiedAt IS NULL) and the snooze would silently no-op.
    await dbm.prepare(
        `UPDATE Reminder SET DueAt = ?, NotifiedAt = NULL WHERE ReminderID = ? AND UserID = ?`
    ).run(newDue, reminderId, userId);
}
