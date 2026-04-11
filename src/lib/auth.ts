import argon2 from 'argon2';
import { createHash } from 'crypto';
import { cookies } from "next/headers";

// ─── DB Encryption Key ────────────────────────────────────────────────────────
// The database encryption key is FIXED per-installation (not per-user).
// This prevents the "database is locked" error when different users register or
// log in — the SQLCipher key is always the same regardless of user password.
//
// In production, set JOURNAL_DB_SECRET in your environment to a securely
// generated 64-hex-char string (32 bytes). A default dev key is used if unset.

const APP_DB_SECRET =
    process.env.JOURNAL_DB_SECRET ??
    'a8f3e2d1b9c4071650e3da98fc24b781a8f3e2d1b9c4071650e3da98fc24b781';

export function getAppDbKey(): string {
    // Always return the fixed 64-hex-char (32-byte) app-level key.
    return createHash('sha256')
        .update(APP_DB_SECRET)
        .digest('hex');
}

// ─── User Password Hashing ────────────────────────────────────────────────────
// User passwords are hashed with Argon2id and stored in the User table.
// This is separate from the DB encryption key.

export async function hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
    });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
        return await argon2.verify(hash, password);
    } catch {
        return false;
    }
}

// ─── Session ──────────────────────────────────────────────────────────────────

export async function getSessionUserId(): Promise<number | null> {
    const cookieStore = await cookies();
    const userIdCookie = cookieStore.get("userId");
    if (!userIdCookie) return null;
    return parseInt(userIdCookie.value, 10);
}
