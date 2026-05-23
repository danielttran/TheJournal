import type { DBManager } from './db';

/**
 * Database maintenance helpers — David RM "Check Integrity & Repair" and
 * "Optimize/Defragment Database". Pure delegations to SQLite PRAGMAs so they
 * can be exercised against a temp .tjdb in vitest.
 */

export interface IntegrityResult {
    ok: boolean;
    /** Raw messages from PRAGMA integrity_check; ['ok'] when healthy. */
    messages: string[];
}

/**
 * Runs `PRAGMA integrity_check`, which walks the b-tree pages and reports
 * structural problems. A healthy database returns a single row "ok".
 */
export async function checkIntegrity(dbm: DBManager): Promise<IntegrityResult> {
    const rows = (await dbm.prepare('PRAGMA integrity_check').all()) as Array<Record<string, unknown>>;
    const messages = rows
        .map(r => String(Object.values(r)[0] ?? '').trim())
        .filter(m => m.length > 0);
    const ok = messages.length === 1 && messages[0].toLowerCase() === 'ok';
    return { ok, messages };
}

export interface OptimizeResult {
    ok: boolean;
    /** Bytes reclaimed (pre minus post file size), when measurable. */
    bytesReclaimed: number | null;
}

/**
 * Checkpoints the WAL into the main database file and then VACUUMs to
 * defragment and reclaim free pages. Returns the byte delta when the file
 * size can be measured (best-effort; null on platforms/paths where it can't).
 */
export async function optimizeDatabase(dbm: DBManager): Promise<OptimizeResult> {
    const before = await safeSize(dbm.dbPath);
    // TRUNCATE checkpoint folds the WAL back into the main file so VACUUM sees
    // the full dataset and the -wal sidecar shrinks to zero.
    await dbm.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
    await dbm.prepare('VACUUM').run();
    const after = await safeSize(dbm.dbPath);
    const bytesReclaimed = before != null && after != null ? Math.max(0, before - after) : null;
    return { ok: true, bytesReclaimed };
}

async function safeSize(path: string): Promise<number | null> {
    try {
        const { stat } = await import('fs/promises');
        return (await stat(path)).size;
    } catch {
        return null;
    }
}
