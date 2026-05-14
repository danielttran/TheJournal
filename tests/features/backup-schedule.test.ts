/**
 * Backup schedule.
 *  - createSchedule / listSchedules / deleteSchedule / setEnabled / markRan
 *  - dueSchedules(now) returns schedules with no LastRun or LastRun older than IntervalDays
 *  - Per-user isolation
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    createSchedule, listSchedules, deleteSchedule, setEnabled,
    markRan, dueSchedules,
} from '../../src/lib/backupSchedule';

const TEST_DB_PATH = join(process.cwd(), `test-backup-sched-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(1, 'a');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(2, 'b');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM BackupSchedule').run();
});

describe('BackupSchedule CRUD', () => {
    it('createSchedule + listSchedules', async () => {
        const id = await createSchedule(dbm, 1, { intervalDays: 7, destPath: 'C:/backup' });
        expect(id).toBeGreaterThan(0);
        const list = await listSchedules(dbm, 1);
        expect(list.length).toBe(1);
        expect(list[0].IntervalDays).toBe(7);
        expect(list[0].DestPath).toBe('C:/backup');
        expect(list[0].Enabled).toBe(1);
    });

    it('deleteSchedule removes it', async () => {
        const id = await createSchedule(dbm, 1, { intervalDays: 1, destPath: 'x' });
        await deleteSchedule(dbm, 1, id);
        expect((await listSchedules(dbm, 1)).length).toBe(0);
    });

    it('setEnabled toggles the flag', async () => {
        const id = await createSchedule(dbm, 1, { intervalDays: 1, destPath: 'x' });
        await setEnabled(dbm, 1, id, false);
        const row = (await listSchedules(dbm, 1))[0];
        expect(row.Enabled).toBe(0);
    });

    it('refuses to delete another user\'s schedule', async () => {
        const id = await createSchedule(dbm, 1, { intervalDays: 1, destPath: 'x' });
        await deleteSchedule(dbm, 2, id);
        expect((await listSchedules(dbm, 1)).length).toBe(1);
    });
});

describe('markRan', () => {
    it('stamps LastRun to current time', async () => {
        const id = await createSchedule(dbm, 1, { intervalDays: 1, destPath: 'x' });
        await markRan(dbm, id);
        const row = (await listSchedules(dbm, 1))[0];
        expect(row.LastRun).toBeTruthy();
    });
});

describe('dueSchedules', () => {
    it('returns schedules that have never run', async () => {
        await createSchedule(dbm, 1, { intervalDays: 7, destPath: 'x' });
        const due = await dueSchedules(dbm, new Date());
        expect(due.length).toBe(1);
    });

    it('returns schedules whose LastRun is older than IntervalDays', async () => {
        const id = await createSchedule(dbm, 1, { intervalDays: 3, destPath: 'x' });
        await dbm.prepare(`UPDATE BackupSchedule SET LastRun = datetime('now', '-5 days') WHERE BackupScheduleID = ?`).run(id);
        const due = await dueSchedules(dbm, new Date());
        expect(due.length).toBe(1);
    });

    it('excludes schedules within their interval', async () => {
        const id = await createSchedule(dbm, 1, { intervalDays: 7, destPath: 'x' });
        await dbm.prepare(`UPDATE BackupSchedule SET LastRun = datetime('now', '-1 days') WHERE BackupScheduleID = ?`).run(id);
        const due = await dueSchedules(dbm, new Date());
        expect(due.length).toBe(0);
    });

    it('excludes disabled schedules', async () => {
        const id = await createSchedule(dbm, 1, { intervalDays: 7, destPath: 'x' });
        await setEnabled(dbm, 1, id, false);
        const due = await dueSchedules(dbm, new Date());
        expect(due.length).toBe(0);
    });
});

describe('per-user isolation', () => {
    it('listSchedules only returns owning user\'s rows', async () => {
        await createSchedule(dbm, 1, { intervalDays: 1, destPath: 'mine' });
        await createSchedule(dbm, 2, { intervalDays: 1, destPath: 'theirs' });
        const list = await listSchedules(dbm, 1);
        expect(list.length).toBe(1);
        expect(list[0].DestPath).toBe('mine');
    });
});
