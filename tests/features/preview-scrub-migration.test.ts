/**
 * Startup data migration: a build predating preview-scrubbing could leave a
 * plaintext PreviewText (a ~200-char body excerpt) on entries in a password-
 * locked category. PreviewText is not decryption-gated on read, so it would leak
 * locked content. Re-opening the DB must scrub it to ''. Unlocked-category
 * previews must be left untouched.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';

const PATH = join(process.cwd(), `test-prevscrub-${Date.now()}.tjdb`);
const KEY = 'deadbeef'.repeat(8);

afterAll(async () => {
    for (const s of ['', '-shm', '-wal']) await unlink(PATH + s).catch(() => {});
});

describe('locked-category PreviewText scrub migration', () => {
    it('blanks plaintext previews in locked categories on reopen, leaves unlocked ones', async () => {
        // Seed: one locked category (PasswordHash set) + one unlocked, each with a
        // plaintext-preview entry.
        const seed = new DBManager(PATH);
        await seed.unlock(KEY);
        await seed.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (1, ?)').run('u');
        const locked = await seed.prepare(
            "INSERT INTO Category (UserID, Name, Type, PasswordHash) VALUES (1, 'L', 'Journal', 'argon2hash')"
        ).run();
        const open = await seed.prepare(
            "INSERT INTO Category (UserID, Name, Type) VALUES (1, 'O', 'Journal')"
        ).run();
        const lockedEntry = await seed.prepare(
            'INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)'
        ).run(locked.lastInsertRowid, 'secret', 'TOP SECRET body excerpt');
        const openEntry = await seed.prepare(
            'INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)'
        ).run(open.lastInsertRowid, 'public', 'visible preview');
        await seed.close();

        // Reopen — initSchema re-runs migrations, including the scrub.
        const reopened = new DBManager(PATH);
        await reopened.unlock(KEY);
        const lp = await reopened.prepare('SELECT PreviewText FROM Entry WHERE EntryID = ?')
            .get(lockedEntry.lastInsertRowid) as { PreviewText: string };
        const op = await reopened.prepare('SELECT PreviewText FROM Entry WHERE EntryID = ?')
            .get(openEntry.lastInsertRowid) as { PreviewText: string };
        expect(lp.PreviewText).toBe('');                  // scrubbed
        expect(op.PreviewText).toBe('visible preview');   // untouched
        await reopened.close();
    });
});
