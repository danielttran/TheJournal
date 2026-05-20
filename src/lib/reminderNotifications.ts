import type { DBManager } from './db';

export interface DueReminder {
    ReminderID: number;
    Title: string;
    Notes: string | null;
    DueAt: string;
    EntryID: number | null;
    EntryCategoryID: number | null;
    ReminderType: string;
    LeadMinutes: number;
}

/**
 * Reminders whose notify-time (DueAt minus LeadMinutes) has been reached and
 * which haven't yet been marked notified. Only "active" non-completed
 * reminders are returned — terminal statuses (done / skipped / canceled /
 * missed) are silently ignored so the popup never wakes up a closed task.
 *
 * `nowIso` is passed in (rather than `new Date()`) so the unit tests can
 * pin the clock; in production code, callers pass `new Date().toISOString()`.
 */
export async function findDueReminders(
    dbm: DBManager,
    userId: number,
    nowIso: string,
): Promise<DueReminder[]> {
    const rows = await dbm.prepare(`
        SELECT r.ReminderID, r.Title, r.Notes, r.DueAt, r.EntryID,
               e.CategoryID AS EntryCategoryID,
               COALESCE(r.ReminderType, 'Appointment') AS ReminderType,
               COALESCE(r.LeadMinutes, 0) AS LeadMinutes
        FROM Reminder r
        LEFT JOIN Entry e ON r.EntryID = e.EntryID
        WHERE r.UserID = ?
          AND r.NotifiedAt IS NULL
          AND COALESCE(r.IsComplete, 0) = 0
          AND COALESCE(r.Status, 'active') NOT IN ('done', 'canceled', 'skipped', 'missed')
          -- Effective notify-time = DueAt - LeadMinutes (minutes). SQLite
          -- datetime() handles ISO-8601 strings directly.
          AND datetime(r.DueAt, '-' || COALESCE(r.LeadMinutes, 0) || ' minutes') <= datetime(?)
        ORDER BY r.DueAt ASC
    `).all(userId, nowIso) as DueReminder[];
    return rows;
}

/**
 * Stamp NotifiedAt so this reminder isn't fired again. Returns true if a
 * row was actually updated (i.e. the reminder exists and belongs to userId).
 */
export async function markReminderNotified(
    dbm: DBManager,
    userId: number,
    reminderId: number,
    nowIso: string,
): Promise<boolean> {
    const res = await dbm.prepare(`
        UPDATE Reminder
        SET NotifiedAt = ?
        WHERE ReminderID = ? AND UserID = ?
    `).run(nowIso, reminderId, userId);
    return (res.changes ?? 0) > 0;
}
