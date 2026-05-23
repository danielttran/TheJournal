/**
 * Feature: Database maintenance (David RM "Check Integrity & Repair" +
 * "Optimize/Defragment Database").
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { checkIntegrity, optimizeDatabase } from '../../src/lib/dbMaintenance';

const TEST_DB_PATH = join(process.cwd(), `test-dbmaint-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (1, ?)').run('me');
    const c = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (1, ?, ?)').run('c', 'Journal');
    const cat = c.lastInsertRowid;
    // Seed + delete rows so VACUUM has free pages to reclaim.
    for (let i = 0; i < 200; i++) {
        await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, EntryType) VALUES (?, ?, ?, 'Page')`
        ).run(cat, `entry ${i}`, 'x'.repeat(500));
    }
    await dbm.prepare('DELETE FROM Entry').run();
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

describe('checkIntegrity', () => {
    it('reports a healthy database as ok', async () => {
        const res = await checkIntegrity(dbm);
        expect(res.ok).toBe(true);
        expect(res.messages).toEqual(['ok']);
    });
});

describe('optimizeDatabase', () => {
    it('vacuums without error and reports byte delta', async () => {
        const res = await optimizeDatabase(dbm);
        expect(res.ok).toBe(true);
        // bytesReclaimed is best-effort: a number ≥ 0 when measurable, else null.
        expect(res.bytesReclaimed === null || res.bytesReclaimed >= 0).toBe(true);
    });

    it('leaves the database queryable and intact after vacuum', async () => {
        await dbm.prepare('SELECT 1').get();
        const res = await checkIntegrity(dbm);
        expect(res.ok).toBe(true);
    });
});
