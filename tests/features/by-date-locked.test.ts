/**
 * The by-date entry loader (POST /api/entry/by-date) must decrypt an existing
 * entry's content before returning it. Regression: it previously returned
 * EntryContent.HtmlContent/DocumentJson raw, so for a password-locked Journal
 * category it surfaced ENC1: ciphertext to the editor (boundary leak) and the
 * next autosave double-encrypted it (data corruption). The route now mirrors
 * GET /api/entry/[id]: decryptEntryContent → plaintext when the EEK is cached,
 * null content + locked=true when it isn't. This guards the contract those two
 * functions implement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { setCategoryPassword } from '../../src/lib/categoryCrypto';
import { maybeEncryptForCategory, decryptEntryContent } from '../../src/lib/entryEncryption';
import { cacheCategoryKey, clearCategoryKey } from '../../src/lib/categoryKeyCache';

const PATH = join(process.cwd(), `test-bydate-lock-${Date.now()}.tjdb`);
const KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let cat = 0;

beforeAll(async () => {
    dbm = new DBManager(PATH);
    await dbm.unlock(KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (1, ?)').run('u');
    const c = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (1, ?, ?)').run('Diary', 'Journal');
    cat = c.lastInsertRowid as number;
    const eek = await setCategoryPassword(dbm, USER_ID, cat, 'pw');
    cacheCategoryKey(USER_ID, cat, eek);
    // A locked journal entry stored at a date (encrypted content).
    const enc = await maybeEncryptForCategory(dbm, USER_ID, cat, '<p>my secret diary</p>', null);
    const e = await dbm.prepare('INSERT INTO Entry (CategoryID, Title, CreatedDate) VALUES (?, ?, ?)')
        .run(cat, 'New Entry', '2026-06-04 12:00:00');
    await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent, DocumentJson) VALUES (?, ?, ?)')
        .run(e.lastInsertRowid, enc.html, enc.documentJson);
});

afterAll(async () => {
    await dbm.close();
    for (const s of ['', '-shm', '-wal']) await unlink(PATH + s).catch(() => {});
});

// Replicates the route's existing-entry SELECT.
async function loadByDate(): Promise<{ HtmlContent: string | null; DocumentJson: string | null }> {
    const row = await dbm.prepare(`
        SELECT ec.HtmlContent, ec.DocumentJson
        FROM Entry e LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE e.CategoryID = ? AND date(e.CreatedDate) = ? AND e.IsDeleted = 0
    `).get(cat, '2026-06-04');
    return row as { HtmlContent: string | null; DocumentJson: string | null };
}

describe('by-date loader decrypts locked-category content', () => {
    it('stores ciphertext, not plaintext (so returning it raw would leak)', async () => {
        const row = await loadByDate();
        expect(row.HtmlContent).not.toBe('<p>my secret diary</p>');
        expect(row.HtmlContent ?? '').toContain('ENC1:');
    });

    it('returns plaintext (not ciphertext) when the EEK is cached', async () => {
        cacheCategoryKey(USER_ID, cat, await reEek());
        const row = await loadByDate();
        const dec = await decryptEntryContent(dbm, USER_ID, cat, row.HtmlContent, row.DocumentJson);
        expect(dec.locked).toBe(false);
        expect(dec.html).toBe('<p>my secret diary</p>');
        expect(dec.html?.startsWith('ENC1:')).toBe(false);
    });

    it('returns null content + locked (no ciphertext leak) when the EEK is NOT cached', async () => {
        clearCategoryKey(USER_ID, cat);
        const row = await loadByDate();
        const dec = await decryptEntryContent(dbm, USER_ID, cat, row.HtmlContent, row.DocumentJson);
        expect(dec.locked).toBe(true);
        expect(dec.html).toBeNull();
    });
});

// Re-derive a cached EEK by re-verifying the password (the original eek buffer
// may have been cleared by a prior test).
async function reEek(): Promise<Uint8Array> {
    const { verifyAndUnwrap } = await import('../../src/lib/categoryCrypto');
    const eek = await verifyAndUnwrap(dbm, USER_ID, cat, 'pw');
    if (!eek) throw new Error('reEek failed');
    return eek;
}
