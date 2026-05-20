/**
 * M3.11 — Per-category password (envelope encryption).
 *
 *   A category can be password-protected. Setting the password:
 *     1. Argon2id-hashes the password (PasswordHash, for verification).
 *     2. Generates a fresh 32-byte EEK (entry encryption key).
 *     3. Derives a KEK from the password via scrypt + per-category salt.
 *     4. AES-256-GCM-encrypts the EEK with the KEK and stores the
 *        ciphertext as PasswordWrappedKey.
 *
 *   The plaintext EEK is never persisted. To unlock, the caller supplies
 *   the password and gets the EEK back — they're expected to cache it
 *   in memory (server-side request scope) and use it to encrypt /
 *   decrypt entry content with `encryptWithKey` / `decryptWithKey`.
 *
 *   Forgetting the password = data is unrecoverable. That's the security
 *   guarantee.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    setCategoryPassword,
    verifyAndUnwrap,
    clearCategoryPassword,
    isCategoryLocked,
    encryptWithKey,
    decryptWithKey,
    ENC_PREFIX,
} from '../../src/lib/categoryCrypto';

const TEST_DB_PATH = join(process.cwd(), `test-m3-pw-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let CAT_ID = 0;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'cat-pw-user');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Category').run();
    const cat = await dbm.prepare(
        `INSERT INTO Category (UserID, Name, Type) VALUES (?, 'Locked', 'Notebook')`
    ).run(USER_ID);
    CAT_ID = Number(cat.lastInsertRowid);
});

describe('Category-password — schema', () => {
    it('Category has PasswordHash, PasswordSalt, PasswordWrappedKey columns', async () => {
        const cols = await dbm.prepare('PRAGMA table_info(Category)').all() as { name: string }[];
        const names = new Set(cols.map(c => c.name));
        for (const required of ['PasswordHash', 'PasswordSalt', 'PasswordWrappedKey']) {
            expect(names.has(required), `missing ${required}`).toBe(true);
        }
    });
});

describe('setCategoryPassword / verifyAndUnwrap', () => {
    it('round-trips: setting then unwrapping returns the same EEK', async () => {
        const eek1 = await setCategoryPassword(dbm, USER_ID, CAT_ID, 'correct horse battery');
        expect(eek1).toBeInstanceOf(Uint8Array);
        expect(eek1.length).toBe(32);

        const eek2 = await verifyAndUnwrap(dbm, USER_ID, CAT_ID, 'correct horse battery');
        expect(eek2).not.toBeNull();
        expect(Buffer.from(eek2!).equals(Buffer.from(eek1))).toBe(true);
    });

    it('verifyAndUnwrap returns null for a wrong password (no EEK leak)', async () => {
        await setCategoryPassword(dbm, USER_ID, CAT_ID, 'right');
        const out = await verifyAndUnwrap(dbm, USER_ID, CAT_ID, 'wrong');
        expect(out).toBeNull();
    });

    it('verifyAndUnwrap returns null for a category that has no password set', async () => {
        const out = await verifyAndUnwrap(dbm, USER_ID, CAT_ID, 'anything');
        expect(out).toBeNull();
    });

    it('isCategoryLocked reflects PasswordHash presence', async () => {
        expect(await isCategoryLocked(dbm, USER_ID, CAT_ID)).toBe(false);
        await setCategoryPassword(dbm, USER_ID, CAT_ID, 'pw');
        expect(await isCategoryLocked(dbm, USER_ID, CAT_ID)).toBe(true);
    });

    it('does not allow cross-tenant unlock — wrong userId returns null', async () => {
        await setCategoryPassword(dbm, USER_ID, CAT_ID, 'pw');
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (2, ?)').run('foreign');
        const out = await verifyAndUnwrap(dbm, 2, CAT_ID, 'pw');
        expect(out).toBeNull();
    });
});

describe('clearCategoryPassword', () => {
    it('removes the password fields after verifying the old password', async () => {
        await setCategoryPassword(dbm, USER_ID, CAT_ID, 'pw');
        const ok = await clearCategoryPassword(dbm, USER_ID, CAT_ID, 'pw');
        expect(ok).toBe(true);
        expect(await isCategoryLocked(dbm, USER_ID, CAT_ID)).toBe(false);
    });

    it('refuses to clear with a wrong password (fail-closed)', async () => {
        await setCategoryPassword(dbm, USER_ID, CAT_ID, 'pw');
        const ok = await clearCategoryPassword(dbm, USER_ID, CAT_ID, 'WRONG');
        expect(ok).toBe(false);
        expect(await isCategoryLocked(dbm, USER_ID, CAT_ID)).toBe(true);
    });
});

describe('encryptWithKey / decryptWithKey', () => {
    let eek: Uint8Array;
    beforeEach(async () => {
        eek = await setCategoryPassword(dbm, USER_ID, CAT_ID, 'pw');
    });

    it('round-trips plaintext through encryption', () => {
        const enc = encryptWithKey('hello world', eek);
        expect(enc.startsWith(ENC_PREFIX)).toBe(true);
        const dec = decryptWithKey(enc, eek);
        expect(dec).toBe('hello world');
    });

    it('produces distinct ciphertext for the same plaintext (fresh IV per call)', () => {
        const a = encryptWithKey('same', eek);
        const b = encryptWithKey('same', eek);
        expect(a).not.toBe(b);
        expect(decryptWithKey(a, eek)).toBe('same');
        expect(decryptWithKey(b, eek)).toBe('same');
    });

    it('decryptWithKey throws on tampered ciphertext (GCM tag rejected)', () => {
        const enc = encryptWithKey('hello', eek);
        // Flip a byte well inside the base64 payload (skip the prefix + first 2 chars).
        const idx = ENC_PREFIX.length + 4;
        const flipped = enc.substring(0, idx) + (enc[idx] === 'A' ? 'B' : 'A') + enc.substring(idx + 1);
        expect(() => decryptWithKey(flipped, eek)).toThrow();
    });

    it('decryptWithKey returns plain string when input lacks the magic prefix (passthrough)', () => {
        // Legacy entries written before the password was set are stored
        // as plain HTML — passthrough so reads keep working.
        expect(decryptWithKey('<p>old plain content</p>', eek)).toBe('<p>old plain content</p>');
    });

    it('throws when decrypting with a different EEK', async () => {
        const enc = encryptWithKey('secret', eek);

        // Make a second category with a different password to derive a different EEK.
        const c = await dbm.prepare(
            `INSERT INTO Category (UserID, Name, Type) VALUES (?, 'Other', 'Notebook')`
        ).run(USER_ID);
        const eek2 = await setCategoryPassword(dbm, USER_ID, Number(c.lastInsertRowid), 'other');
        expect(() => decryptWithKey(enc, eek2)).toThrow();
    });
});
