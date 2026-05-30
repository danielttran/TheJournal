/**
 * Signed session tokens replace the old forgeable plaintext `userId` cookie.
 * These tests pin the security contract: only this server's key produces a
 * token the server accepts, tampering is rejected, and expiry is enforced.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { createSessionToken, verifySessionToken, SESSION_MAX_AGE_SECONDS } from '../../src/lib/session';

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const NOW = 1_700_000_000_000;

describe('session token', () => {
    it('round-trips a user id with the same key', () => {
        const token = createSessionToken(42, NOW, KEY);
        expect(verifySessionToken(token, NOW, KEY)).toBe(42);
    });

    it('rejects a token signed with a different key (forgery / wrong installation)', () => {
        const token = createSessionToken(42, NOW, OTHER_KEY);
        expect(verifySessionToken(token, NOW, KEY)).toBeNull();
    });

    it('rejects a bare integer (the old forgeable cookie format)', () => {
        expect(verifySessionToken('1', NOW, KEY)).toBeNull();
        expect(verifySessionToken('42', NOW, KEY)).toBeNull();
    });

    it('rejects a token whose user id was tampered with', () => {
        const token = createSessionToken(42, NOW, KEY);
        const [, exp, sig] = token.split('.');
        const forged = `1.${exp}.${sig}`; // try to become user 1
        expect(verifySessionToken(forged, NOW, KEY)).toBeNull();
    });

    it('rejects malformed tokens', () => {
        for (const bad of ['', undefined, null, 'a.b', 'a.b.c.d', '...', 'x.y.z']) {
            expect(verifySessionToken(bad as string | undefined, NOW, KEY)).toBeNull();
        }
    });

    it('rejects an expired token', () => {
        const token = createSessionToken(42, NOW, KEY);
        const afterExpiry = NOW + (SESSION_MAX_AGE_SECONDS + 1) * 1000;
        expect(verifySessionToken(token, afterExpiry, KEY)).toBeNull();
        // still valid just before expiry
        expect(verifySessionToken(token, NOW + (SESSION_MAX_AGE_SECONDS - 1) * 1000, KEY)).toBe(42);
    });

    it('rejects non-positive user ids', () => {
        expect(verifySessionToken(createSessionToken(0, NOW, KEY), NOW, KEY)).toBeNull();
        expect(verifySessionToken(createSessionToken(-5, NOW, KEY), NOW, KEY)).toBeNull();
    });
});
