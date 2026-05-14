/**
 * Backup integrity verification.
 *  - computeFileSha256(path) returns hex digest
 *  - verifyBackup(path, expectedHash) returns boolean
 *  - Pure node + crypto so no external dependency
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { computeFileSha256, verifyBackup } from '../../src/lib/backupVerify';

const TMP = join(process.cwd(), `test-bkv-${Date.now()}.bin`);

beforeAll(async () => {
    await writeFile(TMP, 'hello backup');
});
afterAll(async () => {
    await unlink(TMP).catch(() => {});
});

describe('computeFileSha256', () => {
    it('produces a stable 64-hex-char digest', async () => {
        const d1 = await computeFileSha256(TMP);
        const d2 = await computeFileSha256(TMP);
        expect(d1).toMatch(/^[0-9a-f]{64}$/);
        expect(d1).toBe(d2);
    });

    it('produces a different digest for a different file', async () => {
        const other = join(process.cwd(), `test-bkv-other-${Date.now()}.bin`);
        await writeFile(other, 'different content');
        try {
            const d1 = await computeFileSha256(TMP);
            const d2 = await computeFileSha256(other);
            expect(d1).not.toBe(d2);
        } finally {
            await unlink(other).catch(() => {});
        }
    });

    it('throws when file is missing', async () => {
        await expect(computeFileSha256(TMP + '.nope')).rejects.toThrow();
    });
});

describe('verifyBackup', () => {
    it('returns true when the hash matches', async () => {
        const hash = await computeFileSha256(TMP);
        expect(await verifyBackup(TMP, hash)).toBe(true);
    });

    it('returns false when the hash differs', async () => {
        expect(await verifyBackup(TMP, 'a'.repeat(64))).toBe(false);
    });

    it('returns false when the file is missing', async () => {
        expect(await verifyBackup(TMP + '.nope', 'a'.repeat(64))).toBe(false);
    });
});
