/**
 * Web scheduled-backup executor:
 *  - runDueBackups copies a WAL-checkpointed snapshot into each due schedule's
 *    destination directory and stamps LastRun.
 *  - failures don't stamp LastRun (retried next sweep) and don't abort other schedules.
 *  - old snapshots beyond the retention count are pruned.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, readdir, rm, unlink, writeFile, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { DBManager } from '../../src/lib/db';
import { createSchedule, listSchedules } from '../../src/lib/backupSchedule';
import { runDueBackups, backupFileName, BACKUP_RETENTION } from '../../src/lib/backupRunner';

const TEST_DB_PATH = join(process.cwd(), `test-backup-runner-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
let destDir: string;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(1, 'a');
    destDir = await mkdtemp(join(tmpdir(), 'tj-backup-'));
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
    await rm(destDir, { recursive: true, force: true });
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM BackupSchedule').run();
    for (const f of await readdir(destDir)) await unlink(join(destDir, f));
});

describe('runDueBackups', () => {
    it('copies a snapshot for a due schedule and stamps LastRun', async () => {
        await createSchedule(dbm, 1, { intervalDays: 7, destPath: destDir });
        const result = await runDueBackups(dbm);
        expect(result.ran).toBe(1);
        expect(result.errors).toEqual([]);
        const files = await readdir(destDir);
        expect(files.filter(f => /^backup-.*\.tjdb$/.test(f)).length).toBe(1);
        const [row] = await listSchedules(dbm, 1);
        expect(row.LastRun).toBeTruthy();
    });

    it('skips schedules that are not due', async () => {
        const id = await createSchedule(dbm, 1, { intervalDays: 7, destPath: destDir });
        await dbm.prepare(`UPDATE BackupSchedule SET LastRun = datetime('now', '-1 days') WHERE BackupScheduleID = ?`).run(id);
        const result = await runDueBackups(dbm);
        expect(result.ran).toBe(0);
        expect(await readdir(destDir)).toEqual([]);
    });

    it('records an error and leaves LastRun null when the destination is unwritable', async () => {
        // A destination path that collides with an existing FILE → mkdir fails.
        const blocker = join(destDir, 'not-a-dir');
        await writeFile(blocker, 'x');
        await createSchedule(dbm, 1, { intervalDays: 7, destPath: blocker });
        const result = await runDueBackups(dbm);
        expect(result.ran).toBe(0);
        expect(result.errors.length).toBe(1);
        const [row] = await listSchedules(dbm, 1);
        expect(row.LastRun).toBeNull(); // retried on the next sweep
    });

    it('prunes snapshots beyond the retention count (oldest first)', async () => {
        // Seed retention+2 old snapshots with increasing mtimes.
        const old: string[] = [];
        for (let i = 0; i < BACKUP_RETENTION + 1; i++) {
            const name = `backup-seed-${i}.tjdb`;
            await writeFile(join(destDir, name), 'seed');
            const t = new Date(Date.now() - (100 - i) * 60_000);
            await utimes(join(destDir, name), t, t);
            old.push(name);
        }
        await createSchedule(dbm, 1, { intervalDays: 7, destPath: destDir });
        const result = await runDueBackups(dbm);
        expect(result.ran).toBe(1);
        const files = (await readdir(destDir)).filter(f => f.endsWith('.tjdb'));
        expect(files.length).toBe(BACKUP_RETENTION);
        // The two oldest seeds are gone; the fresh snapshot survives.
        expect(files).not.toContain(old[0]);
        expect(files).not.toContain(old[1]);
    });

    it('backupFileName is filesystem-safe', () => {
        expect(backupFileName(new Date('2026-06-09T01:02:03.004Z'))).toBe('backup-2026-06-09T01-02-03-004Z.tjdb');
    });
});
