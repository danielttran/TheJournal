/**
 * Feature: Trash / soft-delete with restore
 *  - Schema: Entry gains IsDeleted (BOOLEAN) + DeletedDate (DATETIME) columns
 *  - softDeleteEntry(id) sets IsDeleted=1 + DeletedDate on entry AND all descendants
 *  - restoreEntry(id) sets IsDeleted=0 + DeletedDate=NULL on entry AND all descendants
 *  - listTrash(userId) returns ONLY top-level deleted entries (don't list descendants twice)
 *  - permanentlyDeleteEntry(id) physically removes the entry + descendants + content
 *  - purgeOldDeletedEntries(daysOld) removes entries deleted more than N days ago
 *  - Normal entry queries should automatically exclude soft-deleted rows
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    softDeleteEntry,
    restoreEntry,
    permanentlyDeleteEntry,
    listTrash,
    purgeOldDeletedEntries,
} from '../../src/lib/trash';

const TEST_DB_PATH = join(process.cwd(), `test-trash-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function createEntry(title: string, parentId: number | null = null): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, ParentEntryID) VALUES (?, ?, ?, ?)`
    ).run(categoryId, title, '', parentId);
    await dbm.prepare(
        `INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)`
    ).run(r.lastInsertRowid, `<p>${title}</p>`);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'trash-user');
    const r = await dbm.prepare(
        'INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)'
    ).run(USER_ID, 'TrashCat', 'Notebook');
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

describe('Trash — schema', () => {
    it('Entry has IsDeleted and DeletedDate columns', async () => {
        const cols = await dbm.prepare(`PRAGMA table_info(Entry)`).all() as { name: string }[];
        const names = new Set(cols.map(c => c.name));
        expect(names.has('IsDeleted')).toBe(true);
        expect(names.has('DeletedDate')).toBe(true);
    });
});

describe('Trash — soft delete', () => {
    it('marks entry IsDeleted=1 + DeletedDate set', async () => {
        const id = await createEntry('victim');
        await softDeleteEntry(dbm, id);
        const row = await dbm.prepare('SELECT IsDeleted, DeletedDate FROM Entry WHERE EntryID = ?').get(id) as any;
        expect(row.IsDeleted).toBe(1);
        expect(row.DeletedDate).toBeTruthy();
    });

    it('cascades to all descendants', async () => {
        const root = await createEntry('root');
        const child = await createEntry('child', root);
        const grandchild = await createEntry('grandchild', child);

        await softDeleteEntry(dbm, root);

        const rows = await dbm.prepare(
            'SELECT EntryID, IsDeleted FROM Entry WHERE EntryID IN (?, ?, ?)'
        ).all(root, child, grandchild) as any[];
        expect(rows.length).toBe(3);
        for (const r of rows) expect(r.IsDeleted).toBe(1);
    });

    it('does not physically delete the entry content', async () => {
        const id = await createEntry('keep-content');
        await softDeleteEntry(dbm, id);
        const content = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(id) as any;
        expect(content).toBeDefined();
        expect(content.HtmlContent).toContain('keep-content');
    });
});

describe('Trash — restore', () => {
    it('clears IsDeleted + DeletedDate', async () => {
        const id = await createEntry('to-restore');
        await softDeleteEntry(dbm, id);
        await restoreEntry(dbm, id);
        const row = await dbm.prepare('SELECT IsDeleted, DeletedDate FROM Entry WHERE EntryID = ?').get(id) as any;
        expect(row.IsDeleted).toBe(0);
        expect(row.DeletedDate).toBeNull();
    });

    it('restores all descendants too', async () => {
        const root = await createEntry('r');
        const child = await createEntry('c', root);
        await softDeleteEntry(dbm, root);
        await restoreEntry(dbm, root);
        const rows = await dbm.prepare(
            'SELECT IsDeleted FROM Entry WHERE EntryID IN (?, ?)'
        ).all(root, child) as any[];
        for (const r of rows) expect(r.IsDeleted).toBe(0);
    });
});

describe('Trash — list', () => {
    it('lists only top-level deleted entries (no orphan descendants)', async () => {
        const root = await createEntry('top');
        const child = await createEntry('c', root);
        await softDeleteEntry(dbm, root);

        const list = await listTrash(dbm, USER_ID);
        const ids = list.map(r => r.EntryID);
        expect(ids).toContain(root);
        expect(ids).not.toContain(child);
    });

    it('excludes non-deleted entries', async () => {
        await createEntry('alive');
        const list = await listTrash(dbm, USER_ID);
        expect(list.length).toBe(0);
    });

    it('only returns entries owned by the user', async () => {
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'other');
        const oCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(99, 'O', 'Notebook');
        const oEntry = await dbm.prepare('INSERT INTO Entry (CategoryID, Title, PreviewText, IsDeleted, DeletedDate) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)').run(oCat.lastInsertRowid, 'other-trash', '');
        const mine = await createEntry('mine');
        await softDeleteEntry(dbm, mine);

        const list = await listTrash(dbm, USER_ID);
        const ids = list.map(r => r.EntryID);
        expect(ids).toContain(mine);
        expect(ids).not.toContain(oEntry.lastInsertRowid);
    });
});

describe('Trash — permanent delete', () => {
    it('physically removes entry + descendants + content', async () => {
        const root = await createEntry('perm-root');
        const child = await createEntry('perm-child', root);
        await softDeleteEntry(dbm, root);
        await permanentlyDeleteEntry(dbm, root);

        const rows = await dbm.prepare('SELECT EntryID FROM Entry WHERE EntryID IN (?, ?)').all(root, child) as any[];
        expect(rows.length).toBe(0);

        const content = await dbm.prepare('SELECT EntryID FROM EntryContent WHERE EntryID IN (?, ?)').all(root, child) as any[];
        expect(content.length).toBe(0);
    });
});

describe('Trash — auto-purge', () => {
    it('removes entries whose DeletedDate is older than the cutoff', async () => {
        const old = await createEntry('old-trash');
        const recent = await createEntry('recent-trash');

        // Backdate `old` by 40 days, mark recent one as just deleted
        await dbm.prepare(`UPDATE Entry SET IsDeleted = 1, DeletedDate = datetime('now', '-40 days') WHERE EntryID = ?`).run(old);
        await dbm.prepare(`UPDATE Entry SET IsDeleted = 1, DeletedDate = CURRENT_TIMESTAMP WHERE EntryID = ?`).run(recent);

        const purged = await purgeOldDeletedEntries(dbm, 30);
        expect(purged).toBeGreaterThanOrEqual(1);

        const stillThere = await dbm.prepare('SELECT EntryID FROM Entry WHERE EntryID IN (?, ?)').all(old, recent) as any[];
        const ids = stillThere.map(r => r.EntryID);
        expect(ids).not.toContain(old);
        expect(ids).toContain(recent);
    });
});
