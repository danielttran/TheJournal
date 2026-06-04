/**
 * Per-category passwords (DavidRM parity).
 *
 * Envelope encryption: the user's password derives a Key Encryption Key
 * (KEK) via scrypt. The KEK wraps a random 32-byte Entry Encryption Key
 * (EEK). The plaintext EEK is never persisted; only the wrapped form is.
 *
 * Verifying the password (Argon2id) unlocks the EEK; the EEK then
 * encrypts/decrypts entry HtmlContent / DocumentJson with AES-256-GCM.
 *
 * Forgetting the password = data is unrecoverable. There is no recovery
 * path on purpose — that's the security guarantee.
 *
 *   PasswordHash       — Argon2id(password). Used only for verification.
 *   PasswordSalt       — 16-byte hex salt. Feeds scrypt to derive the KEK.
 *   PasswordWrappedKey — base64( IV(12) || ciphertext || tag(16) ).
 */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';
import { hashPassword, verifyPassword } from './auth';
import type { DBManager } from './db';

const KEK_KEYLEN = 32;          // 256-bit AES key
const SCRYPT_N = 1 << 15;       // 32k. Modest cost so multiple unlocks/sec are OK.
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;            // GCM standard nonce length
const TAG_BYTES = 16;

export const ENC_PREFIX = 'ENC1:';

function deriveKEK(password: string, saltHex: string): Buffer {
    const salt = Buffer.from(saltHex, 'hex');
    // maxmem default is 32 MB which is tight for N=2^15 r=8; bump explicitly.
    return scryptSync(password, salt, KEK_KEYLEN, {
        N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
        maxmem: 64 * 1024 * 1024,
    });
}

function wrap(eek: Buffer, kek: Buffer): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', kek, iv);
    const ct = Buffer.concat([cipher.update(eek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]).toString('base64');
}

function unwrap(wrappedBase64: string, kek: Buffer): Buffer {
    const blob = Buffer.from(wrappedBase64, 'base64');
    if (blob.length < IV_BYTES + TAG_BYTES) throw new Error('Wrapped key truncated');
    const iv = blob.subarray(0, IV_BYTES);
    const tag = blob.subarray(blob.length - TAG_BYTES);
    const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Encrypt arbitrary text with the category's EEK. Output is a single
 * string carrying ENC_PREFIX + base64(IV || ciphertext || tag).
 *
 * Pre-existing plaintext (no prefix) is left as-is by decryptWithKey so
 * legacy entries keep working — see decryptWithKey passthrough behaviour.
 */
export function encryptWithKey(plaintext: string, eek: Uint8Array): string {
    if (eek.length !== KEK_KEYLEN) throw new Error('Bad EEK length');
    const key = Buffer.from(eek);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENC_PREFIX + Buffer.concat([iv, ct, tag]).toString('base64');
}

/**
 * Decrypt a value previously written by encryptWithKey. Returns the
 * input unchanged when it lacks the ENC_PREFIX magic — that covers
 * legacy entries written before the category had a password.
 */
export function decryptWithKey(input: string, eek: Uint8Array): string {
    if (!input.startsWith(ENC_PREFIX)) return input;
    if (eek.length !== KEK_KEYLEN) throw new Error('Bad EEK length');
    const key = Buffer.from(eek);
    const blob = Buffer.from(input.substring(ENC_PREFIX.length), 'base64');
    if (blob.length < IV_BYTES + TAG_BYTES) throw new Error('Ciphertext truncated');
    const iv = blob.subarray(0, IV_BYTES);
    const tag = blob.subarray(blob.length - TAG_BYTES);
    const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Sets a category password. Generates a fresh EEK, derives a KEK from the
 * password, wraps the EEK, and stores PasswordHash + PasswordSalt +
 * PasswordWrappedKey. Returns the (plaintext) EEK so the caller can use
 * it to encrypt the category's existing entries if they wish.
 *
 * Refuses to overwrite an existing password — the caller must clear it
 * first with the old password to avoid data loss.
 */
export async function setCategoryPassword(
    dbm: DBManager,
    userId: number,
    categoryId: number,
    password: string,
): Promise<Uint8Array> {
    const existing = await dbm.prepare(
        'SELECT PasswordHash FROM Category WHERE CategoryID = ? AND UserID = ?'
    ).get(categoryId, userId) as { PasswordHash: string | null } | undefined;
    if (!existing) throw new Error('Category not found');
    if (existing.PasswordHash) {
        throw new Error('Category already locked — clear the existing password first');
    }

    const eek = randomBytes(KEK_KEYLEN);
    const saltHex = randomBytes(SALT_BYTES).toString('hex');
    const kek = deriveKEK(password, saltHex);
    const wrapped = wrap(eek, kek);
    const passwordHash = await hashPassword(password);

    // Race guard: only succeed if PasswordHash is still NULL at write time.
    // A concurrent setCategoryPassword that won the race already populated
    // the row — refuse rather than silently overwrite their key material.
    const res = await dbm.prepare(`
        UPDATE Category
        SET PasswordHash = ?, PasswordSalt = ?, PasswordWrappedKey = ?
        WHERE CategoryID = ? AND UserID = ? AND PasswordHash IS NULL
    `).run(passwordHash, saltHex, wrapped, categoryId, userId);
    if (!res.changes) {
        throw new Error('Category already locked — clear the existing password first');
    }

    return new Uint8Array(eek);
}

/**
 * Verify the password and return the unwrapped EEK on success.
 * Returns null on any failure — wrong password, missing category,
 * cross-tenant access, or corrupted ciphertext.
 */
export async function verifyAndUnwrap(
    dbm: DBManager,
    userId: number,
    categoryId: number,
    password: string,
): Promise<Uint8Array | null> {
    const row = await dbm.prepare(`
        SELECT PasswordHash, PasswordSalt, PasswordWrappedKey
        FROM Category WHERE CategoryID = ? AND UserID = ?
    `).get(categoryId, userId) as {
        PasswordHash: string | null;
        PasswordSalt: string | null;
        PasswordWrappedKey: string | null;
    } | undefined;
    if (!row || !row.PasswordHash || !row.PasswordSalt || !row.PasswordWrappedKey) return null;

    const ok = await verifyPassword(row.PasswordHash, password);
    if (!ok) return null;

    try {
        const kek = deriveKEK(password, row.PasswordSalt);
        const eek = unwrap(row.PasswordWrappedKey, kek);
        return new Uint8Array(eek);
    } catch {
        return null;
    }
}

/**
 * Returns true when the category currently has a password set.
 */
export async function isCategoryLocked(
    dbm: DBManager,
    userId: number,
    categoryId: number,
): Promise<boolean> {
    const row = await dbm.prepare(
        'SELECT PasswordHash FROM Category WHERE CategoryID = ? AND UserID = ?'
    ).get(categoryId, userId) as { PasswordHash: string | null } | undefined;
    return !!row?.PasswordHash;
}

/**
 * Walk every EntryContent row belonging to `categoryId` (scoped to `userId`)
 * and rewrite HtmlContent + DocumentJson using the supplied transform.
 *
 * The transform receives the current value and returns either:
 *   - the new value (string) to persist,
 *   - the same reference unchanged (no UPDATE issued for this row's field).
 *
 * Used by:
 *   - initial lock:  plaintext → ENC1:base64 with new EEK.
 *   - clear lock:    ENC1:base64 → plaintext with old EEK.
 *   - rotate:        ENC1:base64 (old EEK) → ENC1:base64 (new EEK).
 *
 * Atomic. If the transform throws on any row (e.g. corrupted ciphertext
 * fails GCM verification), the SQLite transaction rolls back so the
 * caller never sees a half-decrypted category. Without this, a single
 * corrupt entry during a "Remove password" flow would let the password
 * be cleared while leaving the rest of the category unreadable → silent
 * data loss.
 */
export type EntryContentTransform = (current: string) => string | null;

export async function transformCategoryEntries(
    dbm: DBManager,
    userId: number,
    categoryId: number,
    transform: EntryContentTransform,
    // Optional step run INSIDE the same transaction after every row is
    // transformed (e.g. clearing the category password during "remove password").
    // Keeping it in-tx means no concurrent save can land between the decrypt and
    // the password change and write fresh ciphertext that becomes undecryptable.
    afterTransform?: () => Promise<void>,
): Promise<number> {
    const work = dbm.transaction(async () => {
        const rows = await dbm.prepare(`
            SELECT ec.EntryID, ec.HtmlContent, ec.DocumentJson
            FROM EntryContent ec
            JOIN Entry e ON ec.EntryID = e.EntryID
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.CategoryID = ? AND c.UserID = ?
        `).all(categoryId, userId) as {
            EntryID: number;
            HtmlContent: string | null;
            DocumentJson: string | null;
        }[];

        let touched = 0;
        for (const row of rows) {
            const newHtml = row.HtmlContent != null ? transform(row.HtmlContent) : null;
            const newJson = row.DocumentJson != null ? transform(row.DocumentJson) : null;
            const htmlChanged = newHtml !== null && newHtml !== row.HtmlContent;
            const jsonChanged = newJson !== null && newJson !== row.DocumentJson;
            if (!htmlChanged && !jsonChanged) continue;
            await dbm.prepare(
                'UPDATE EntryContent SET HtmlContent = ?, DocumentJson = ? WHERE EntryID = ?'
            ).run(
                htmlChanged ? newHtml : row.HtmlContent,
                jsonChanged ? newJson : row.DocumentJson,
                row.EntryID,
            );
            touched += 1;
        }
        if (afterTransform) await afterTransform();
        return touched;
    });
    return await work();
}

/**
 * Clear the category's password fields WITHOUT verification or re-encryption.
 * Internal building block — callers must have already verified the password
 * (and decrypted the content). Exposed so the clear-password flow can run it
 * inside the same transaction as the decrypt (see transformCategoryEntries'
 * afterTransform).
 */
export async function clearCategoryPasswordFields(
    dbm: DBManager,
    userId: number,
    categoryId: number,
): Promise<void> {
    await dbm.prepare(`
        UPDATE Category
        SET PasswordHash = NULL, PasswordSalt = NULL, PasswordWrappedKey = NULL
        WHERE CategoryID = ? AND UserID = ?
    `).run(categoryId, userId);
}

/**
 * Clear the password (verifying the old one first). Returns true on
 * success. NOTE: this does NOT re-encrypt the category's entries — any
 * existing ciphertext stays ciphertext. The caller is expected to
 * decrypt entries with the EEK from verifyAndUnwrap BEFORE calling
 * this, then re-save them as plaintext.
 */
export async function clearCategoryPassword(
    dbm: DBManager,
    userId: number,
    categoryId: number,
    password: string,
): Promise<boolean> {
    const eek = await verifyAndUnwrap(dbm, userId, categoryId, password);
    if (!eek) return false;
    await clearCategoryPasswordFields(dbm, userId, categoryId);
    return true;
}

/**
 * Rotate the category password atomically.
 *
 *   1. Verify the old password and unwrap the EEK.
 *   2. Generate a brand-new EEK so a compromised old key can't decrypt
 *      future content.
 *   3. Derive a fresh KEK from newPassword + new salt.
 *   4. UPDATE the category in one statement so concurrent readers never
 *      see a partially-set state (NULL PasswordHash mid-rotation).
 *
 * Returns { oldEek, newEek }. Caller is expected to re-encrypt entry
 * content from oldEek to newEek and then forget the oldEek.
 */
export async function rotateCategoryPassword(
    dbm: DBManager,
    userId: number,
    categoryId: number,
    oldPassword: string,
    newPassword: string,
): Promise<{ oldEek: Uint8Array; newEek: Uint8Array } | null> {
    const oldEek = await verifyAndUnwrap(dbm, userId, categoryId, oldPassword);
    if (!oldEek) return null;

    const newEek = randomBytes(KEK_KEYLEN);
    const saltHex = randomBytes(SALT_BYTES).toString('hex');
    const kek = deriveKEK(newPassword, saltHex);
    const wrapped = wrap(newEek, kek);
    const passwordHash = await hashPassword(newPassword);

    const result = await dbm.prepare(`
        UPDATE Category
        SET PasswordHash = ?, PasswordSalt = ?, PasswordWrappedKey = ?
        WHERE CategoryID = ? AND UserID = ? AND PasswordHash IS NOT NULL
    `).run(passwordHash, saltHex, wrapped, categoryId, userId);

    if (!result.changes) return null;  // category vanished or got unlocked concurrently

    return { oldEek, newEek: new Uint8Array(newEek) };
}
