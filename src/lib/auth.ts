import argon2 from 'argon2';
import { createHash } from 'crypto';

// ─── DB Encryption Key ────────────────────────────────────────────────────────
// The database encryption key is FIXED per-installation (not per-user).
// This prevents the "database is locked" error when different users register or
// log in — the SQLCipher key is always the same regardless of user password.
//
// In production, set JOURNAL_DB_SECRET in your environment to a securely
// generated 64-hex-char string (32 bytes). A default dev key is used if unset.

const DEV_DEFAULT_DB_SECRET =
    'a8f3e2d1b9c4071650e3da98fc24b781a8f3e2d1b9c4071650e3da98fc24b781';

const APP_DB_SECRET = process.env.JOURNAL_DB_SECRET ?? DEV_DEFAULT_DB_SECRET;

let warnedAboutDefaultSecret = false;
function checkDbSecret() {
    if (APP_DB_SECRET !== DEV_DEFAULT_DB_SECRET) return;
    if (process.env.NODE_ENV === 'production') {
        // Hard failure: shipping the default DB secret in production means
        // any attacker who lifts the .tjdb file from disk can read every
        // entry. Refuse to start instead of silently degrading security.
        throw new Error(
            'JOURNAL_DB_SECRET must be set in production. Generate one with `openssl rand -hex 32`. ' +
            'See docs/env-vars.md.'
        );
    }
    // Dev mode: warn once so the user notices the misconfiguration before
    // production. printed-once because the key is read on every request.
    if (!warnedAboutDefaultSecret) {
        warnedAboutDefaultSecret = true;
        console.warn(
            '[auth] JOURNAL_DB_SECRET unset — using the dev default key. ' +
            'Do NOT deploy this build to production without overriding it.'
        );
    }
}

// Fire the check at module-import time so a misconfigured production
// server surfaces the error on the first request that touches an
// auth-using route — including /api/health. That's good enough for
// production monitoring: the next upstream healthcheck flips the route
// to degraded and the operator gets alerted.
//
// Skip during `next build` — Next.js evaluates server modules at build
// time to collect page data, and the build host won't (and shouldn't)
// have the production DB secret. The runtime check still fires when
// the production server starts and the first request lands.
if (process.env.NEXT_PHASE !== 'phase-production-build') {
    checkDbSecret();
}

export function getAppDbKey(): string {
    // Re-check on every call too — vitest tests `vi.resetModules()` and
    // re-imports auth.ts with mutated env vars, so a fresh check per
    // call preserves the per-test contract.
    checkDbSecret();
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
