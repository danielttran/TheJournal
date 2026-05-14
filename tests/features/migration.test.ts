/**
 * Audit: schema migration idempotency
 *  - Re-unlocking the same DB runs migrations again — must not error or duplicate columns
 *  - All new columns appear after first unlock
 *  - All new tables appear after first unlock
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';

const TEST_DB_PATH = join(process.cwd(), `test-migration-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);

afterAll(async () => {
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

describe('Schema migrations', () => {
    it('creates all expected tables on a fresh DB', async () => {
        const dbm = new DBManager(TEST_DB_PATH);
        await dbm.unlock(TEST_KEY);
        const rows = await dbm.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
        ).all() as { name: string }[];
        const names = new Set(rows.map(r => r.name));
        for (const t of ['User', 'Category', 'Entry', 'EntryContent', 'Template', 'Attachment', 'Reminder', 'WordGoal', 'SavedSearch']) {
            expect(names.has(t), `missing table ${t}`).toBe(true);
        }
        await dbm.close();
    });

    it('adds Sprint 3/4 columns to Entry on a fresh DB', async () => {
        const dbm = new DBManager(TEST_DB_PATH);
        await dbm.unlock(TEST_KEY);
        const cols = await dbm.prepare(`PRAGMA table_info(Entry)`).all() as { name: string }[];
        const names = new Set(cols.map(c => c.name));
        for (const col of ['IsDeleted', 'DeletedDate', 'IsPinned', 'PinnedDate', 'Mood', 'IsFavorited', 'Tags']) {
            expect(names.has(col), `missing column ${col}`).toBe(true);
        }
        await dbm.close();
    });

    it('is idempotent: re-running migrations does not error', async () => {
        // Open + close + reopen exercises the migration loop a second time.
        const dbm1 = new DBManager(TEST_DB_PATH);
        await dbm1.unlock(TEST_KEY);
        await dbm1.close();
        const dbm2 = new DBManager(TEST_DB_PATH);
        await expect(dbm2.unlock(TEST_KEY)).resolves.not.toThrow();
        const cols = await dbm2.prepare(`PRAGMA table_info(Entry)`).all() as { name: string }[];
        // Sanity check: column count is stable (no duplicate adds)
        const idCount = cols.filter(c => c.name === 'IsDeleted').length;
        expect(idCount).toBe(1);
        await dbm2.close();
    });

    it('indexes are created without duplicates', async () => {
        const dbm = new DBManager(TEST_DB_PATH);
        await dbm.unlock(TEST_KEY);
        const rows = await dbm.prepare(
            `SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name`
        ).all() as { name: string }[];
        const names = rows.map(r => r.name);
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        expect(dupes).toEqual([]);
        for (const idx of ['Idx_Entry_Deleted', 'Idx_Entry_Pinned', 'Idx_Reminder_User_Due', 'Idx_WordGoal_User', 'Idx_SavedSearch_User']) {
            expect(names).toContain(idx);
        }
        await dbm.close();
    });
});
