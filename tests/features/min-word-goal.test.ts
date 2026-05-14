/**
 * Per-entry minimum word goal.
 *  - checkWordMinimum(html, min) returns {meets, count, min}
 *  - Stored as UserSetting 'minWordsPerEntry'; getMinWordGoal/setMinWordGoal helpers
 *  - 0 disables the goal (meets always true)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { checkWordMinimum, getMinWordGoal, setMinWordGoal } from '../../src/lib/minWordGoal';

const TEST_DB_PATH = join(process.cwd(), `test-min-word-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'm');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare(`DELETE FROM UserSetting WHERE UserID = ?`).run(USER_ID);
});

describe('checkWordMinimum', () => {
    it('returns meets=true when content is above the threshold', () => {
        const r = checkWordMinimum('<p>one two three four five</p>', 3);
        expect(r.meets).toBe(true);
        expect(r.count).toBe(5);
        expect(r.min).toBe(3);
    });

    it('returns meets=false when below threshold', () => {
        const r = checkWordMinimum('<p>too short</p>', 10);
        expect(r.meets).toBe(false);
        expect(r.count).toBe(2);
    });

    it('returns meets=true when min is 0 (disabled)', () => {
        expect(checkWordMinimum('', 0).meets).toBe(true);
        expect(checkWordMinimum('<p>one</p>', 0).meets).toBe(true);
    });

    it('handles null/empty input', () => {
        expect(checkWordMinimum('', 5).meets).toBe(false);
        expect(checkWordMinimum(null as any, 5).meets).toBe(false);
    });
});

describe('getMinWordGoal / setMinWordGoal', () => {
    it('defaults to 0 (disabled)', async () => {
        expect(await getMinWordGoal(dbm, USER_ID)).toBe(0);
    });

    it('setMinWordGoal persists + getMinWordGoal reads', async () => {
        await setMinWordGoal(dbm, USER_ID, 250);
        expect(await getMinWordGoal(dbm, USER_ID)).toBe(250);
    });

    it('rejects negative values', async () => {
        await expect(setMinWordGoal(dbm, USER_ID, -1)).rejects.toThrow();
    });

    it('rejects unreasonably large values', async () => {
        await expect(setMinWordGoal(dbm, USER_ID, 10_000_000)).rejects.toThrow();
    });
});
