/**
 * Multi-tenant admin gate: the bootstrap admin is the lowest UserID (first
 * registered). Cross-tenant routes (whole-DB export, user management) check
 * isAdminUser so a non-admin account can't export everyone's data or delete
 * other accounts. Single-user installs are unaffected (the only user is admin).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { getAdminUserId, isAdminUser } from '../../src/lib/admin';

const TEST_DB_PATH = join(process.cwd(), `test-admin-guard-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM User').run();
});

async function addUser(name: string): Promise<number> {
    const r = await dbm.prepare('INSERT INTO User (Username) VALUES (?)').run(name);
    return Number(r.lastInsertRowid);
}

describe('admin guard', () => {
    it('returns null admin when there are no users', async () => {
        expect(await getAdminUserId(dbm)).toBeNull();
    });

    it('treats the single user as admin', async () => {
        const a = await addUser('alice');
        expect(await getAdminUserId(dbm)).toBe(a);
        expect(await isAdminUser(a, dbm)).toBe(true);
    });

    it('only the lowest UserID is admin in a multi-user install', async () => {
        const a = await addUser('alice');
        const b = await addUser('bob');
        const c = await addUser('carol');
        expect(await getAdminUserId(dbm)).toBe(a);
        expect(await isAdminUser(a, dbm)).toBe(true);
        expect(await isAdminUser(b, dbm)).toBe(false);
        expect(await isAdminUser(c, dbm)).toBe(false);
    });

    it('promotes the next-lowest user to admin after the first is deleted', async () => {
        const a = await addUser('alice');
        const b = await addUser('bob');
        await dbm.prepare('DELETE FROM User WHERE UserID = ?').run(a);
        expect(await getAdminUserId(dbm)).toBe(b);
        expect(await isAdminUser(b, dbm)).toBe(true);
    });
});
