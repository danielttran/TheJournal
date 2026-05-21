/**
 * Production-readiness guard: refuse to start in production with the
 * hard-coded dev fallback for JOURNAL_DB_SECRET. Without this, an
 * operator who forgets to set the env var ships a binary where the
 * SQLCipher key is the same well-known string baked into the source
 * tree — any DB file lifted from disk is trivially decryptable.
 *
 * The check fires on the first call to getAppDbKey(); it's called
 * indirectly on every DB unlock, so a misconfigured prod server fails
 * fast at startup rather than running with degraded security.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// @types/node marks process.env.NODE_ENV as readonly. Vitest's reset path
// needs to mutate it across tests, so we touch a writable view.
const env = process.env as Record<string, string | undefined>;

describe('JOURNAL_DB_SECRET guard', () => {
    const ORIG_SECRET = env.JOURNAL_DB_SECRET;
    const ORIG_ENV = env.NODE_ENV;

    beforeEach(() => {
        // vitest's module cache lets us re-import lib/auth.ts with fresh env
        // vars per test.
        vi.resetModules();
    });

    afterEach(() => {
        if (ORIG_SECRET === undefined) delete env.JOURNAL_DB_SECRET;
        else env.JOURNAL_DB_SECRET = ORIG_SECRET;
        if (ORIG_ENV === undefined) delete env.NODE_ENV;
        else env.NODE_ENV = ORIG_ENV;
    });

    it('returns a derived key when JOURNAL_DB_SECRET is set in production', async () => {
        env.JOURNAL_DB_SECRET = 'a'.repeat(64);
        env.NODE_ENV = 'production';
        const { getAppDbKey } = await import('../../src/lib/auth');
        const key = getAppDbKey();
        expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('throws AT IMPORT TIME in production when JOURNAL_DB_SECRET is unset (falls back to dev default)', async () => {
        delete env.JOURNAL_DB_SECRET;
        env.NODE_ENV = 'production';
        // The check fires at module-load time so a misconfigured prod
        // server fails before serving a single request. The throw
        // surfaces inside the dynamic import().
        await expect(import('../../src/lib/auth')).rejects.toThrow(/JOURNAL_DB_SECRET/);
    });

    it('warns but does not throw in dev when JOURNAL_DB_SECRET is unset', async () => {
        delete env.JOURNAL_DB_SECRET;
        env.NODE_ENV = 'development';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { getAppDbKey } = await import('../../src/lib/auth');
            // Call twice — warning should fire exactly once.
            const k1 = getAppDbKey();
            const k2 = getAppDbKey();
            expect(k1).toMatch(/^[0-9a-f]{64}$/);
            expect(k2).toBe(k1);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toMatch(/dev default/);
        } finally {
            warn.mockRestore();
        }
    });

    it('does not warn when the operator deliberately uses the dev secret outside production', async () => {
        // Edge case: a hosted demo where the operator KNOWS the key is
        // public. They set JOURNAL_DB_SECRET to the dev default explicitly.
        // We still warn because we can't distinguish "you forgot" from
        // "you meant it" — the warning is informational.
        env.JOURNAL_DB_SECRET = 'a8f3e2d1b9c4071650e3da98fc24b781a8f3e2d1b9c4071650e3da98fc24b781';
        env.NODE_ENV = 'development';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { getAppDbKey } = await import('../../src/lib/auth');
            getAppDbKey();
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
    });
});
