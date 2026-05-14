import {
    randomBytes,
    pbkdf2Sync,
    createCipheriv,
    createDecipheriv,
    timingSafeEqual,
} from 'node:crypto';

/**
 * Per-entry encryption — David RM "locked entry" parity.
 *
 * The journal's SQLCipher database is already encrypted at rest; this is a
 * SECOND layer keyed on a password the user types per entry. Useful for the
 * "lock this entry from anyone with the DB password" workflow.
 *
 * Algorithm: PBKDF2-SHA256 (100 000 iterations, 32-byte key) → AES-256-GCM
 * with a fresh random 12-byte IV and 16-byte salt per encrypt call. The
 * 16-byte GCM auth tag is appended to the ciphertext so tampering is
 * detected at decrypt time.
 *
 * The blob fields are base64 strings for safe storage in a TEXT column.
 */

const KDF_ITERATIONS = 100_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const ENCRYPTED_BLOB_VERSION = 1;

export interface EncryptedBlob {
    version: number;        // schema marker for forward compatibility
    salt: string;           // base64
    iv: string;             // base64
    ciphertext: string;     // base64 (includes the 16-byte GCM auth tag at the tail)
}

function deriveKey(password: string, salt: Buffer): Buffer {
    return pbkdf2Sync(password, salt, KDF_ITERATIONS, KEY_BYTES, 'sha256');
}

export function encryptEntry(plaintext: string, password: string): EncryptedBlob {
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('encryptEntry: password required');
    }
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const key = deriveKey(password, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([
        cipher.update(plaintext ?? '', 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    if (tag.length !== TAG_BYTES) {
        throw new Error('encryptEntry: unexpected auth-tag length');
    }
    return {
        version: ENCRYPTED_BLOB_VERSION,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    };
}

/**
 * Decrypts a blob. Throws on wrong password OR tampered ciphertext — the GCM
 * auth tag makes the two failure modes indistinguishable, by design. Callers
 * that only need a boolean test should wrap this in try/catch.
 */
export function decryptEntry(blob: EncryptedBlob, password: string): string {
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('decryptEntry: password required');
    }
    if (!blob || blob.version !== ENCRYPTED_BLOB_VERSION) {
        throw new Error('decryptEntry: unsupported blob version');
    }
    const salt = Buffer.from(blob.salt, 'base64');
    const iv = Buffer.from(blob.iv, 'base64');
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) {
        throw new Error('decryptEntry: corrupt salt/iv');
    }
    const all = Buffer.from(blob.ciphertext, 'base64');
    if (all.length < TAG_BYTES) {
        throw new Error('decryptEntry: ciphertext truncated');
    }
    const tag = all.subarray(all.length - TAG_BYTES);
    const ct = all.subarray(0, all.length - TAG_BYTES);
    const key = deriveKey(password, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    return out.toString('utf8');
}

/** Check a password without raising — convenient for UI "unlock" buttons. */
export function tryDecryptEntry(blob: EncryptedBlob, password: string): string | null {
    try { return decryptEntry(blob, password); }
    catch { return null; }
}

/**
 * Constant-time string compare for password equality checks where both
 * candidates are already in hand (e.g., confirm-password UI).
 */
export function constantTimeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}
