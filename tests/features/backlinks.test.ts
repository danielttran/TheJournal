/**
 * Feature: Entry backlinks ("Referenced by")
 *  - findBacklinks(dbm, userId, entryId) scans all entries' HtmlContent for
 *    [[Title]] or [[#id]] references that resolve to `entryId`.
 *  - Returns the referring entries (id + title + categoryId + categoryName).
 *  - Excludes soft-deleted referring entries.
 *  - Scoped to the requesting user.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { findBacklinks } from '../../src/lib/backlinks';

const TEST_DB_PATH = join(process.cwd(), `test-bl-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function entry(title: string, html: string): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`
    ).run(categoryId, title, '');
    await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(r.lastInsertRowid, html);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'bl');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'BL', 'Notebook');
    categoryId = r.lastInsertRowid;
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Entry WHERE CategoryID = ?').run(categoryId);
});

describe('findBacklinks', () => {
    it('returns entries that link via a journal://entry anchor (hyperlink dialog / entry: refs)', async () => {
        const target = await entry('Anchored', '<p>target body</p>');
        const ref = await entry('Linker', `<p>see <a href="journal://entry/${target}">this</a></p>`);
        await entry('Decoy', `<p><a href="journal://entry/${target}99">different id prefix</a></p>`);

        const backs = await findBacklinks(dbm, USER_ID, target);
        expect(backs.map(b => b.EntryID)).toEqual([ref]);
    });

    it('returns entries that link by title', async () => {
        const target = await entry('Project Plan', '<p>plan body</p>');
        const ref = await entry('Daily Notes', '<p>see [[Project Plan]] for context</p>');
        await entry('Other', '<p>nothing here</p>');

        const backs = await findBacklinks(dbm, USER_ID, target);
        expect(backs.map(b => b.EntryID)).toEqual([ref]);
    });

    it('returns entries that link by [[#id]] form', async () => {
        const target = await entry('Target', '');
        const ref = await entry('Linker', `<p>see [[#${target}]] over there</p>`);
        const backs = await findBacklinks(dbm, USER_ID, target);
        expect(backs.map(b => b.EntryID)).toEqual([ref]);
    });

    it('matches title case-insensitively', async () => {
        const target = await entry('Spike Doc', '');
        const ref = await entry('Other', '<p>per [[spike doc]] decision</p>');
        const backs = await findBacklinks(dbm, USER_ID, target);
        expect(backs.map(b => b.EntryID)).toEqual([ref]);
    });

    it('excludes soft-deleted referrers', async () => {
        const target = await entry('A', '');
        const ref = await entry('B', '<p>[[A]]</p>');
        await dbm.prepare('UPDATE Entry SET IsDeleted = 1 WHERE EntryID = ?').run(ref);
        const backs = await findBacklinks(dbm, USER_ID, target);
        expect(backs).toEqual([]);
    });

    it('does not include the target itself even if it self-links', async () => {
        const target = await entry('Self', '<p>I refer to [[Self]]</p>');
        const backs = await findBacklinks(dbm, USER_ID, target);
        expect(backs).toEqual([]);
    });

    it('does not leak across users', async () => {
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'them');
        const otherCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(99, 'X', 'Notebook');
        const target = await entry('Mine', '');
        // Other user has an entry pretending to link to "Mine"
        const otherEntry = await dbm.prepare('INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)').run(otherCat.lastInsertRowid, 'theirs', '');
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(otherEntry.lastInsertRowid, '<p>[[Mine]]</p>');

        const backs = await findBacklinks(dbm, USER_ID, target);
        expect(backs).toEqual([]);
    });

    it('returns multiple referring entries', async () => {
        const target = await entry('Hub', '');
        const a = await entry('A', '<p>[[Hub]]</p>');
        const b = await entry('B', '<p>[[Hub]]</p>');
        const backs = await findBacklinks(dbm, USER_ID, target);
        expect(backs.map(b => b.EntryID).sort()).toEqual([a, b].sort());
    });
});
