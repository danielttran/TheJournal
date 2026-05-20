/**
 * M1 — Entry lock enforcement on writes.
 *
 * `Entry.IsLocked` is exposed via the sidebar context menu, but the existing
 * PUT /api/entry/[id] route happily overwrites HtmlContent for a locked entry
 * — a TipTap save from another tab could clobber the read-only entry. We
 * fence content/title writes behind the lock in the shared library that
 * powers the route.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { isWriteToLockedEntryBlocked } from '../../src/lib/entryLock';

const TEST_DB_PATH = join(process.cwd(), `test-m1-lock-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let CAT_ID = 0;
let LOCKED_ID = 0;
let UNLOCKED_ID = 0;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'lock-user');
    const cat = await dbm.prepare(
        `INSERT INTO Category (UserID, Name, Type) VALUES (?, 'Journal', 'Journal')`
    ).run(USER_ID);
    CAT_ID = Number(cat.lastInsertRowid);
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Entry').run();
    const a = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, IsLocked) VALUES (?, 'Locked', 1)`
    ).run(CAT_ID);
    LOCKED_ID = Number(a.lastInsertRowid);
    const b = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, IsLocked) VALUES (?, 'Free', 0)`
    ).run(CAT_ID);
    UNLOCKED_ID = Number(b.lastInsertRowid);
});

describe('isWriteToLockedEntryBlocked', () => {
    it('blocks content writes on locked entries', async () => {
        expect(await isWriteToLockedEntryBlocked(dbm, LOCKED_ID, { html: '<p>x</p>' })).toBe(true);
        expect(await isWriteToLockedEntryBlocked(dbm, LOCKED_ID, { documentJson: { type: 'doc' } })).toBe(true);
        expect(await isWriteToLockedEntryBlocked(dbm, LOCKED_ID, { title: 'rename' })).toBe(true);
        expect(await isWriteToLockedEntryBlocked(dbm, LOCKED_ID, { preview: 'p' })).toBe(true);
    });

    it('allows lock-only updates (so the user can unlock from the menu)', async () => {
        expect(await isWriteToLockedEntryBlocked(dbm, LOCKED_ID, { isLocked: false })).toBe(false);
        expect(await isWriteToLockedEntryBlocked(dbm, LOCKED_ID, { isLocked: true })).toBe(false);
    });

    it('allows metadata-only updates (mood/favorite/tag) on a locked entry', async () => {
        // Mood, favorite, and tag mutations are metadata and shouldn't be
        // gated by the lock — DavidRM lets you tag a locked entry.
        expect(await isWriteToLockedEntryBlocked(dbm, LOCKED_ID, { mood: ':)' })).toBe(false);
        expect(await isWriteToLockedEntryBlocked(dbm, LOCKED_ID, { isFavorited: true })).toBe(false);
        expect(await isWriteToLockedEntryBlocked(dbm, LOCKED_ID, { tags: '["work"]' })).toBe(false);
    });

    it('never blocks writes on unlocked entries', async () => {
        expect(await isWriteToLockedEntryBlocked(dbm, UNLOCKED_ID, { html: '<p>x</p>' })).toBe(false);
        expect(await isWriteToLockedEntryBlocked(dbm, UNLOCKED_ID, { title: 'New' })).toBe(false);
    });

    it('returns false (not blocked) for a nonexistent entry — the route already 404s those', async () => {
        expect(await isWriteToLockedEntryBlocked(dbm, 9999, { html: 'x' })).toBe(false);
    });
});
