import type { DBManager } from './db';

export interface BackupSchedule {
    BackupScheduleID: number;
    UserID: number;
    IntervalDays: number;
    DestPath: string;
    LastRun: string | null;
    Enabled: number;
}

export interface CreateScheduleInput {
    intervalDays: number;
    destPath: string;
}

export async function createSchedule(dbm: DBManager, userId: number, input: CreateScheduleInput): Promise<number> {
    if (!Number.isFinite(input.intervalDays) || input.intervalDays < 1) {
        throw new Error('intervalDays must be a positive integer');
    }
    if (!input.destPath || !input.destPath.trim()) throw new Error('destPath required');
    const r = await dbm.prepare(
        `INSERT INTO BackupSchedule (UserID, IntervalDays, DestPath) VALUES (?, ?, ?)`
    ).run(userId, input.intervalDays, input.destPath);
    return r.lastInsertRowid;
}

export async function listSchedules(dbm: DBManager, userId: number): Promise<BackupSchedule[]> {
    return dbm.prepare(
        `SELECT * FROM BackupSchedule WHERE UserID = ? ORDER BY BackupScheduleID ASC`
    ).all(userId) as Promise<BackupSchedule[]>;
}

export async function deleteSchedule(dbm: DBManager, userId: number, id: number): Promise<void> {
    await dbm.prepare(
        `DELETE FROM BackupSchedule WHERE BackupScheduleID = ? AND UserID = ?`
    ).run(id, userId);
}

export async function setEnabled(dbm: DBManager, userId: number, id: number, enabled: boolean): Promise<void> {
    await dbm.prepare(
        `UPDATE BackupSchedule SET Enabled = ? WHERE BackupScheduleID = ? AND UserID = ?`
    ).run(enabled ? 1 : 0, id, userId);
}

export async function markRan(dbm: DBManager, id: number): Promise<void> {
    await dbm.prepare(
        `UPDATE BackupSchedule SET LastRun = CURRENT_TIMESTAMP WHERE BackupScheduleID = ?`
    ).run(id);
}

/**
 * Schedules due to run now: never run OR LastRun older than IntervalDays ago.
 * `now` is accepted for testability — SQLite uses CURRENT_TIMESTAMP server-side
 * for the actual comparison so we don't have to round-trip the date.
 */
export async function dueSchedules(dbm: DBManager, _now: Date): Promise<BackupSchedule[]> {
    return dbm.prepare(`
        SELECT * FROM BackupSchedule
        WHERE Enabled = 1
          AND (LastRun IS NULL OR datetime(LastRun, '+' || IntervalDays || ' days') <= datetime('now'))
        ORDER BY BackupScheduleID ASC
    `).all() as Promise<BackupSchedule[]>;
}
