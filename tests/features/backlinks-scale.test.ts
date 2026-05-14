/**
 * Backlinks scale test: 5000 candidate entries.
 * Currently uses LIKE '%[[%' table scan. Want to verify it completes in
 * reasonable time at this scale and lock in a perf budget.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { findBacklinks } from '../../src/lib/backlinks';

const TEST_DB_PATH = join(process.cwd(), `test-bl-scale-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;
let targetId: number;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'sc');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'BL', 'Notebook');
    categoryId = r.lastInsertRowid;
    const t = await dbm.prepare('INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)').run(categoryId, 'Hub', '');
    targetId = t.lastInsertRowid;
    await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(targetId, '');

    // 5000 entries: 250 reference target, 4750 plain (LIKE filter prunes most)
    for (let i = 0; i < 5000; i++) {
        const e = await dbm.prepare('INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)').run(categoryId, `e${i}`, '');
        const html = i % 20 === 0 ? '<p>see [[Hub]]</p>' : '<p>plain entry text here</p>';
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(e.lastInsertRowid, html);
    }
}, 120_000);

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

describe('findBacklinks @ 5000 entries', () => {
    it('returns correct count and completes within 5 seconds', async () => {
        const start = Date.now();
        const backs = await findBacklinks(dbm, USER_ID, targetId);
        const elapsed = Date.now() - start;
        // 5000 / 20 = 250 referrers
        expect(backs.length).toBe(250);
        // Budget: 5s. Locks in current behavior; alerts on regression.
        expect(elapsed).toBeLessThan(5000);
    }, 30_000);
});
