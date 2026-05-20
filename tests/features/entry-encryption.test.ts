/**
 * Audit round 3 surfaced that loadEntryHtmlForRead is the security boundary
 * between locked-category ciphertext and the read endpoints (print, export,
 * report, search). It was previously untested. Same for decryptEntryContent
 * and maybeEncryptForCategory which gate the write side.
 *
 * Tests verify:
 *  - Plaintext passes through unchanged.
 *  - Ciphertext decrypts when the EEK is cached.
 *  - Ciphertext returns the "locked" sentinel when the EEK is not cached.
 *  - Tampered ciphertext fails closed (no plaintext leak).
 *  - Cross-tenant isolation (an EEK cached for user A cannot decrypt
 *    user B's content).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    encryptWithKey,
    setCategoryPassword,
    ENC_PREFIX,
} from '../../src/lib/categoryCrypto';
import {
    cacheCategoryKey,
    clearCategoryKey,
    clearAllForUser,
} from '../../src/lib/categoryKeyCache';
import {
    decryptEntryContent,
    loadEntryHtmlForRead,
    maybeEncryptForCategory,
    getEntryCategoryId,
} from '../../src/lib/entryEncryption';

const TEST_DB_PATH = join(process.cwd(), `test-entry-enc-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
const OTHER_USER_ID = 2;
let CAT_ID = 0;
let UNLOCKED_CAT_ID = 0;
let EEK: Uint8Array;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'ee-user');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(OTHER_USER_ID, 'other-user');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    clearAllForUser(USER_ID);
    clearAllForUser(OTHER_USER_ID);
    await dbm.prepare('DELETE FROM Entry').run();
    await dbm.prepare('DELETE FROM Category').run();
    const locked = await dbm.prepare(
        `INSERT INTO Category (UserID, Name, Type) VALUES (?, 'Locked', 'Notebook')`
    ).run(USER_ID);
    CAT_ID = Number(locked.lastInsertRowid);
    const unlocked = await dbm.prepare(
        `INSERT INTO Category (UserID, Name, Type) VALUES (?, 'Open', 'Notebook')`
    ).run(USER_ID);
    UNLOCKED_CAT_ID = Number(unlocked.lastInsertRowid);
    EEK = await setCategoryPassword(dbm, USER_ID, CAT_ID, 'pw');
});

describe('loadEntryHtmlForRead', () => {
    it('returns an empty string for null content', async () => {
        const out = await loadEntryHtmlForRead(dbm, USER_ID, UNLOCKED_CAT_ID, null);
        expect(out).toBe('');
    });

    it('passes plaintext through unchanged when content lacks the prefix', async () => {
        const out = await loadEntryHtmlForRead(dbm, USER_ID, UNLOCKED_CAT_ID, '<p>just html</p>');
        expect(out).toBe('<p>just html</p>');
    });

    it('decrypts when the EEK is cached', async () => {
        cacheCategoryKey(USER_ID, CAT_ID, EEK);
        const ciphertext = encryptWithKey('<p>secret note</p>', EEK);
        expect(ciphertext.startsWith(ENC_PREFIX)).toBe(true);
        const out = await loadEntryHtmlForRead(dbm, USER_ID, CAT_ID, ciphertext);
        expect(out).toBe('<p>secret note</p>');
    });

    it('returns null (locked sentinel) when the category is locked but no EEK cached', async () => {
        const ciphertext = encryptWithKey('<p>secret</p>', EEK);
        // EEK is NOT cached — simulates a fresh request before unlock.
        const out = await loadEntryHtmlForRead(dbm, USER_ID, CAT_ID, ciphertext);
        expect(out).toBeNull();
    });

    it('returns null on tampered ciphertext even with EEK cached (fail-closed)', async () => {
        cacheCategoryKey(USER_ID, CAT_ID, EEK);
        const ciphertext = encryptWithKey('<p>tamper me</p>', EEK);
        // Flip one byte well inside the base64 payload.
        const idx = ENC_PREFIX.length + 6;
        const tampered = ciphertext.substring(0, idx) + (ciphertext[idx] === 'A' ? 'B' : 'A') + ciphertext.substring(idx + 1);
        const out = await loadEntryHtmlForRead(dbm, USER_ID, CAT_ID, tampered);
        expect(out).toBeNull();
    });

    it('does not let user A decrypt user B\'s ciphertext via cached EEK', async () => {
        // Cache the EEK for USER_ID and try to decrypt with a foreign userId.
        cacheCategoryKey(USER_ID, CAT_ID, EEK);
        const ciphertext = encryptWithKey('<p>private</p>', EEK);
        const out = await loadEntryHtmlForRead(dbm, OTHER_USER_ID, CAT_ID, ciphertext);
        expect(out).toBeNull();
    });
});

describe('decryptEntryContent', () => {
    it('returns locked=false + nulls passed-through for plaintext rows', async () => {
        const out = await decryptEntryContent(dbm, USER_ID, UNLOCKED_CAT_ID, '<p>plain</p>', '{"type":"doc"}');
        expect(out.locked).toBe(false);
        expect(out.html).toBe('<p>plain</p>');
        expect(out.documentJson).toBe('{"type":"doc"}');
    });

    it('returns locked=true with nulled html/json when EEK is missing', async () => {
        const ct = encryptWithKey('<p>x</p>', EEK);
        const out = await decryptEntryContent(dbm, USER_ID, CAT_ID, ct, ct);
        expect(out.locked).toBe(true);
        expect(out.html).toBeNull();
        expect(out.documentJson).toBeNull();
    });

    it('decrypts both fields when EEK is cached', async () => {
        cacheCategoryKey(USER_ID, CAT_ID, EEK);
        const html = encryptWithKey('<p>html</p>', EEK);
        const json = encryptWithKey('{"type":"doc"}', EEK);
        const out = await decryptEntryContent(dbm, USER_ID, CAT_ID, html, json);
        expect(out.locked).toBe(false);
        expect(out.html).toBe('<p>html</p>');
        expect(out.documentJson).toBe('{"type":"doc"}');
    });

    it('treats only-one-encrypted as encrypted (looksEncrypted is OR not AND)', async () => {
        cacheCategoryKey(USER_ID, CAT_ID, EEK);
        const html = encryptWithKey('<p>html</p>', EEK);
        const out = await decryptEntryContent(dbm, USER_ID, CAT_ID, html, null);
        expect(out.locked).toBe(false);
        expect(out.html).toBe('<p>html</p>');
        expect(out.documentJson).toBeNull();
    });

    it('returns locked + nulls when one field has tampered ciphertext', async () => {
        cacheCategoryKey(USER_ID, CAT_ID, EEK);
        const tampered = ENC_PREFIX + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
        const out = await decryptEntryContent(dbm, USER_ID, CAT_ID, tampered, null);
        expect(out.locked).toBe(true);
    });
});

describe('maybeEncryptForCategory', () => {
    it('passes through unchanged when the category has no password', async () => {
        const out = await maybeEncryptForCategory(
            dbm, USER_ID, UNLOCKED_CAT_ID, '<p>plain</p>', '{"a":1}',
        );
        expect(out.html).toBe('<p>plain</p>');
        expect(out.documentJson).toBe('{"a":1}');
    });

    it('throws CATEGORY_LOCKED when category is locked but EEK is not cached', async () => {
        await expect(
            maybeEncryptForCategory(dbm, USER_ID, CAT_ID, '<p>x</p>', '{}')
        ).rejects.toMatchObject({ message: expect.stringMatching(/locked/i), code: 'CATEGORY_LOCKED' });
    });

    it('encrypts both fields when EEK is cached', async () => {
        cacheCategoryKey(USER_ID, CAT_ID, EEK);
        const out = await maybeEncryptForCategory(
            dbm, USER_ID, CAT_ID, '<p>secret</p>', '{"type":"doc"}',
        );
        expect(out.html?.startsWith(ENC_PREFIX)).toBe(true);
        expect(out.documentJson?.startsWith(ENC_PREFIX)).toBe(true);
    });

    it('passes nulls through (UPDATE with no change to that field)', async () => {
        cacheCategoryKey(USER_ID, CAT_ID, EEK);
        const out = await maybeEncryptForCategory(dbm, USER_ID, CAT_ID, null, null);
        expect(out.html).toBeNull();
        expect(out.documentJson).toBeNull();
    });

    it('does not encrypt for a category belonging to a different user (no cross-tenant lock)', async () => {
        // Cat belongs to USER_ID; OTHER_USER_ID looks it up — no row returned →
        // PasswordHash check finds nothing → passes through.
        const out = await maybeEncryptForCategory(
            dbm, OTHER_USER_ID, CAT_ID, '<p>plain</p>', null,
        );
        expect(out.html).toBe('<p>plain</p>');
    });
});

describe('getEntryCategoryId', () => {
    it('returns the CategoryID for an existing entry', async () => {
        const r = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title) VALUES (?, 't')`
        ).run(CAT_ID);
        const id = await getEntryCategoryId(dbm, Number(r.lastInsertRowid));
        expect(id).toBe(CAT_ID);
    });

    it('returns null for a missing entry', async () => {
        expect(await getEntryCategoryId(dbm, 9999)).toBeNull();
    });
});

describe('cleanup behaviour', () => {
    it('clearCategoryKey removes the cached EEK so subsequent reads see locked', async () => {
        cacheCategoryKey(USER_ID, CAT_ID, EEK);
        const ct = encryptWithKey('x', EEK);
        expect(await loadEntryHtmlForRead(dbm, USER_ID, CAT_ID, ct)).toBe('x');
        clearCategoryKey(USER_ID, CAT_ID);
        expect(await loadEntryHtmlForRead(dbm, USER_ID, CAT_ID, ct)).toBeNull();
    });
});
