/**
 * Feature: user login-password change (David RM "Change Password").
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { hashPassword, verifyPassword } from '../../src/lib/auth';
import { changeUserPassword } from '../../src/lib/userPassword';

const TEST_DB_PATH = join(process.cwd(), `test-userpw-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
});

beforeEach(async () => {
    const h = await hashPassword('correct-horse');
    await dbm.prepare('DELETE FROM User').run();
    await dbm.prepare('INSERT INTO User (UserID, Username, PasswordHash) VALUES (?, ?, ?)').run(USER_ID, 'me', h);
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

describe('changeUserPassword', () => {
    it('rotates the hash when the current password is correct', async () => {
        const res = await changeUserPassword(dbm, USER_ID, 'correct-horse', 'new-battery-staple');
        expect(res).toEqual({ ok: true });
        const row = await dbm.prepare('SELECT PasswordHash FROM User WHERE UserID = ?').get(USER_ID) as { PasswordHash: string };
        expect(await verifyPassword(row.PasswordHash, 'new-battery-staple')).toBe(true);
        expect(await verifyPassword(row.PasswordHash, 'correct-horse')).toBe(false);
    });

    it('rejects a wrong current password and leaves the hash unchanged', async () => {
        const before = await dbm.prepare('SELECT PasswordHash FROM User WHERE UserID = ?').get(USER_ID) as { PasswordHash: string };
        const res = await changeUserPassword(dbm, USER_ID, 'wrong', 'new-battery-staple');
        expect(res).toEqual({ ok: false, reason: 'wrong-password' });
        const after = await dbm.prepare('SELECT PasswordHash FROM User WHERE UserID = ?').get(USER_ID) as { PasswordHash: string };
        expect(after.PasswordHash).toBe(before.PasswordHash);
    });

    it('rejects a too-short new password', async () => {
        const res = await changeUserPassword(dbm, USER_ID, 'correct-horse', 'short');
        expect(res).toEqual({ ok: false, reason: 'weak' });
    });

    it('reports not-found for an unknown user', async () => {
        const res = await changeUserPassword(dbm, 9999, 'correct-horse', 'new-battery-staple');
        expect(res).toEqual({ ok: false, reason: 'not-found' });
    });
});
