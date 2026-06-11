import { copyFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import type { DBManager } from './db';
import { dueSchedules, markRan } from './backupSchedule';
import { computeFileSha256, verifyBackup } from './backupVerify';

/**
 * Executes due BackupSchedule rows on the WEB target (Electron has its own
 * userData-settings auto-backup in main.js). Each run checkpoints the WAL so
 * the copied .tjdb is self-contained, writes a timestamped snapshot into the
 * schedule's destination directory, and prunes old snapshots.
 *
 * Schedules are admin-only (whole-DB snapshots, same trust level as
 * backup/export) — see the schedule routes.
 */

export interface BackupRunResult {
    ran: number;
    errors: string[];
}

/** Snapshots kept per destination directory; oldest pruned beyond this. */
export const BACKUP_RETENTION = 5;

export function backupFileName(now: Date = new Date()): string {
    return `backup-${now.toISOString().replace(/[:.]/g, '-')}.tjdb`;
}

async function pruneOldBackups(dir: string, keep: number): Promise<void> {
    const files = await readdir(dir).catch(() => [] as string[]);
    const snapshots: { path: string; mtimeMs: number }[] = [];
    for (const f of files) {
        if (!/^backup-.*\.tjdb$/.test(f)) continue;
        const full = join(dir, f);
        const s = await stat(full).catch(() => null);
        if (s) snapshots.push({ path: full, mtimeMs: s.mtimeMs });
    }
    snapshots.sort((a, b) => a.mtimeMs - b.mtimeMs);
    while (snapshots.length > keep) {
        const oldest = snapshots.shift()!;
        await unlink(oldest.path).catch(() => {});
    }
}

export async function runDueBackups(dbm: DBManager, now: Date = new Date()): Promise<BackupRunResult> {
    const result: BackupRunResult = { ran: 0, errors: [] };
    const due = await dueSchedules(dbm, now);
    if (due.length === 0) return result;

    // One checkpoint per sweep — flushes WAL pages into the main file so the
    // plain file copy below is a consistent snapshot.
    try {
        await dbm.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
    } catch (err) {
        result.errors.push(`wal_checkpoint failed: ${(err as Error).message}`);
        return result;
    }

    // Source hash once per sweep (post-checkpoint). A concurrent write between
    // this hash and a copy makes verification fail → that schedule retries
    // next sweep instead of silently keeping a torn snapshot.
    let sourceHash: string;
    try {
        sourceHash = await computeFileSha256(dbm.dbPath);
    } catch (err) {
        result.errors.push(`hashing source DB failed: ${(err as Error).message}`);
        return result;
    }

    for (const schedule of due) {
        const dest = join(schedule.DestPath, backupFileName(now));
        try {
            await mkdir(schedule.DestPath, { recursive: true });
            await copyFile(dbm.dbPath, dest);
            if (!await verifyBackup(dest, sourceHash)) {
                await unlink(dest).catch(() => {});
                throw new Error('snapshot verification failed (database changed mid-copy); will retry');
            }
            await pruneOldBackups(schedule.DestPath, BACKUP_RETENTION);
            // Only stamp LastRun on success so a failed run retries next sweep.
            await markRan(dbm, schedule.BackupScheduleID);
            result.ran += 1;
        } catch (err) {
            result.errors.push(`schedule ${schedule.BackupScheduleID} → ${schedule.DestPath}: ${(err as Error).message}`);
        }
    }
    return result;
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

/**
 * Starts the hourly due-backup sweep (idempotent — a module-reload during dev
 * must not stack intervals). Started from db.ts module scope at server start.
 */
export function startBackupSweep(dbm: DBManager): void {
    const g = globalThis as { __tjBackupSweep?: NodeJS.Timeout };
    if (g.__tjBackupSweep) return;
    const sweep = () => {
        runDueBackups(dbm).then(r => {
            if (r.ran > 0) console.log(`[backup] ran ${r.ran} scheduled backup(s)`);
            for (const e of r.errors) console.error('[backup] scheduled backup error:', e);
        }).catch(err => console.error('[backup] sweep failed:', err));
    };
    g.__tjBackupSweep = setInterval(sweep, SWEEP_INTERVAL_MS);
    // Don't hold the process open just for the sweep.
    g.__tjBackupSweep.unref?.();
    // First sweep shortly after boot (give the DB unlock a moment).
    setTimeout(sweep, 30_000).unref?.();
}
