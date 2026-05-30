/**
 * Signed session tokens.
 *
 * The session cookie used to be the bare integer user id, which any client
 * could forge (`Cookie: userId=1`) to impersonate any account. A token is now
 * an HMAC-signed `userId.expiry.signature` triple: the server can read the user
 * id straight out of the cookie (no session table) but cannot be lied to,
 * because the signature is keyed by the installation secret.
 *
 * Pure + dependency-free so it unit-tests without a DB. The signing key is
 * injectable for tests; in app code it comes from getSessionSigningKey().
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getSessionSigningKey } from './auth';

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function sign(payload: string, key: Buffer): string {
    return createHmac('sha256', key).update(payload).digest('base64url');
}

export function createSessionToken(
    userId: number,
    nowMs: number = Date.now(),
    key: Buffer = getSessionSigningKey(),
): string {
    const exp = Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS;
    const payload = `${userId}.${exp}`;
    return `${payload}.${sign(payload, key)}`;
}

/**
 * Returns the user id if the token is well-formed, correctly signed, and not
 * expired; otherwise null. Uses a constant-time signature compare so a forged
 * token can't be brute-forced byte-by-byte via timing.
 */
export function verifySessionToken(
    token: string | undefined | null,
    nowMs: number = Date.now(),
    key: Buffer = getSessionSigningKey(),
): number | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [uidStr, expStr, sig] = parts;

    const expected = sign(`${uidStr}.${expStr}`, key);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const exp = Number(expStr);
    if (!Number.isInteger(exp) || exp < Math.floor(nowMs / 1000)) return null;

    const userId = Number(uidStr);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    return userId;
}
