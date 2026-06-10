/**
 * J8 per-category week-start day: WeekStartDay column exists (idempotent
 * migration), defaults to Sunday (0), and round-trips updates.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';

const TEST_DB_PATH = join(process.cwd(), `test-weekstart-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (1, ?)').run('ws');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

describe('Category.WeekStartDay', () => {
    it('exists with a Sunday (0) default', async () => {
        const cols = await dbm.prepare(`PRAGMA table_info(Category)`).all() as { name: string; dflt_value: string | null }[];
        const col = cols.find(c => c.name === 'WeekStartDay');
        expect(col).toBeTruthy();
        const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (1, ?, ?)').run('Cal', 'Journal');
        const row = await dbm.prepare('SELECT WeekStartDay FROM Category WHERE CategoryID = ?').get(r.lastInsertRowid) as { WeekStartDay: number };
        expect(row.WeekStartDay).toBe(0);
    });

    it('round-trips an update (Monday start)', async () => {
        const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (1, ?, ?)').run('Mon', 'Journal');
        await dbm.prepare('UPDATE Category SET WeekStartDay = 1 WHERE CategoryID = ?').run(r.lastInsertRowid);
        const row = await dbm.prepare('SELECT WeekStartDay FROM Category WHERE CategoryID = ?').get(r.lastInsertRowid) as { WeekStartDay: number };
        expect(row.WeekStartDay).toBe(1);
    });
});
