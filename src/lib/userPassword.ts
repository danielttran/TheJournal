import type { DBManager } from './db';
import { hashPassword, verifyPassword } from './auth';

/**
 * User login-password change — David RM "Change Password". Verifies the
 * current password against the stored Argon2id hash, then re-hashes the new
 * one and writes it back.
 *
 * Note on encryption: the at-rest SQLCipher key is derived from
 * JOURNAL_DB_SECRET, NOT the user's login password, so changing the login
 * password does NOT require bulk re-encryption of entries. Per-category
 * passwords are a separate envelope and are rotated via /api/category/[id]/lock.
 */

export const MIN_PASSWORD_LENGTH = 8;

export type ChangePasswordResult =
    | { ok: true }
    | { ok: false; reason: 'weak' | 'not-found' | 'wrong-password' };

export async function changeUserPassword(
    dbm: DBManager,
    userId: number,
    oldPassword: string,
    newPassword: string,
): Promise<ChangePasswordResult> {
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
        return { ok: false, reason: 'weak' };
    }

    const row = (await dbm
        .prepare('SELECT PasswordHash FROM User WHERE UserID = ?')
        .get(userId)) as { PasswordHash: string | null } | undefined;

    if (!row) return { ok: false, reason: 'not-found' };

    // A legacy row may have a null hash (pre-migration). Treat any non-empty
    // current password as wrong rather than silently allowing a reset.
    if (!row.PasswordHash) return { ok: false, reason: 'wrong-password' };

    const okOld = await verifyPassword(row.PasswordHash, oldPassword);
    if (!okOld) return { ok: false, reason: 'wrong-password' };

    const newHash = await hashPassword(newPassword);
    await dbm.prepare('UPDATE User SET PasswordHash = ? WHERE UserID = ?').run(newHash, userId);
    return { ok: true };
}
