/**
 * UserSetting key/value store.
 *  - getSetting / setSetting / deleteSetting
 *  - getAllSettings(userId) returns a flat {key: value} map
 *  - Per-user isolation
 *  - Specific helpers: getDateFormat / setDateFormat (validate format string)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    getSetting, setSetting, deleteSetting, getAllSettings,
    getDateFormat, setDateFormat, validateDateFormat,
} from '../../src/lib/settings';

const TEST_DB_PATH = join(process.cwd(), `test-settings-${Date.now()}.tjdb`);
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
    await dbm.prepare('DELETE FROM UserSetting').run();
});

describe('UserSetting CRUD', () => {
    it('setSetting + getSetting round-trip', async () => {
        await setSetting(dbm, 1, 'dateFormat', 'PP');
        expect(await getSetting(dbm, 1, 'dateFormat')).toBe('PP');
    });

    it('getSetting returns null when missing', async () => {
        expect(await getSetting(dbm, 1, 'nope')).toBeNull();
    });

    it('setSetting upserts (changes existing value)', async () => {
        await setSetting(dbm, 1, 'k', 'v1');
        await setSetting(dbm, 1, 'k', 'v2');
        expect(await getSetting(dbm, 1, 'k')).toBe('v2');
    });

    it('deleteSetting removes the row', async () => {
        await setSetting(dbm, 1, 'k', 'v');
        await deleteSetting(dbm, 1, 'k');
        expect(await getSetting(dbm, 1, 'k')).toBeNull();
    });

    it('getAllSettings returns map per user', async () => {
        await setSetting(dbm, 1, 'a', '1');
        await setSetting(dbm, 1, 'b', '2');
        await setSetting(dbm, 2, 'a', 'other');
        const map = await getAllSettings(dbm, 1);
        expect(map).toEqual({ a: '1', b: '2' });
    });

    it('per-user isolation', async () => {
        await setSetting(dbm, 1, 'shared', 'mine');
        await setSetting(dbm, 2, 'shared', 'yours');
        expect(await getSetting(dbm, 1, 'shared')).toBe('mine');
        expect(await getSetting(dbm, 2, 'shared')).toBe('yours');
    });
});

describe('validateDateFormat', () => {
    it('accepts known tokens (date-fns)', () => {
        expect(validateDateFormat('yyyy-MM-dd')).toBe(true);
        expect(validateDateFormat('PP')).toBe(true);
        expect(validateDateFormat('MMM d, yyyy')).toBe(true);
    });

    it('rejects empty input', () => {
        expect(validateDateFormat('')).toBe(false);
        expect(validateDateFormat('   ')).toBe(false);
    });

    it('rejects strings longer than reasonable', () => {
        expect(validateDateFormat('x'.repeat(200))).toBe(false);
    });
});

describe('getDateFormat / setDateFormat', () => {
    it('defaults to "PP" when not set', async () => {
        expect(await getDateFormat(dbm, 1)).toBe('PP');
    });

    it('setDateFormat persists + getDateFormat reads', async () => {
        await setDateFormat(dbm, 1, 'yyyy-MM-dd');
        expect(await getDateFormat(dbm, 1)).toBe('yyyy-MM-dd');
    });

    it('setDateFormat rejects invalid format', async () => {
        await expect(setDateFormat(dbm, 1, '')).rejects.toThrow();
    });
});
