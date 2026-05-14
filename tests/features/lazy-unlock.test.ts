/**
 * Regression: the `db` proxy from src/lib/db must auto-unlock on first query.
 * In dev mode with Turbopack, server components/routes may run in a fresh
 * worker process where the singleton DBManager has no unlocked instance.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { dbManager, db, ensureUnlocked } from '../../src/lib/db';

const TEST_DB_PATH = join(process.cwd(), `test-lazy-${Date.now()}.tjdb`);

beforeAll(async () => {
    process.env.JOURNAL_DB_PATH = TEST_DB_PATH;
    // Do NOT unlock here — verifying that db.prepare itself triggers unlock
});

afterAll(async () => {
    await dbManager.close();
    delete process.env.JOURNAL_DB_PATH;
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

describe('Lazy unlock via db proxy', () => {
    it('ensureUnlocked unlocks without throwing', async () => {
        expect(dbManager.instance).toBeNull();
        await ensureUnlocked();
        expect(dbManager.instance).not.toBeNull();
    });

    it('db.prepare(...).get(...) auto-unlocks if needed', async () => {
        // Force-close to simulate a fresh worker that has never unlocked.
        await dbManager.close();
        expect(dbManager.instance).toBeNull();

        const row = await db.prepare('SELECT 1 AS one').get() as { one: number };
        expect(row.one).toBe(1);
        expect(dbManager.instance).not.toBeNull();
    });

    it('db.transaction(...)(...) auto-unlocks', async () => {
        await dbManager.close();
        expect(dbManager.instance).toBeNull();

        const tx = db.transaction(async () => {
            const r = await db.prepare('SELECT 2 AS two').get() as { two: number };
            return r.two;
        });
        const result = await tx();
        expect(result).toBe(2);
    });
});
