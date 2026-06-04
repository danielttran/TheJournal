/**
 * Moving an entry to another category must take its whole subtree with it.
 * Regression: only the target entry moved (ParentEntryID cleared), stranding
 * descendants in the source category pointing at a now-cross-category parent —
 * orphaning them in the tree and violating the subtree-CTE invariant.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { moveEntrySubtreeToCategory } from '../../src/lib/entryMove';

const TEST_DB_PATH = join(process.cwd(), `test-movecat-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let srcCat: number;
let dstCat: number;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'mc');
    const a = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'Source', 'Journal');
    const b = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'Dest', 'Journal');
    srcCat = a.lastInsertRowid; dstCat = b.lastInsertRowid;
});

afterAll(async () => {
    await dbm.close();
    for (const s of ['', '-shm', '-wal']) await unlink(TEST_DB_PATH + s).catch(() => {});
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Entry').run();
});

async function mkEntry(cat: number, title: string, parent: number | null): Promise<number> {
    const r = await dbm.prepare(
        'INSERT INTO Entry (CategoryID, Title, ParentEntryID, EntryType) VALUES (?, ?, ?, ?)'
    ).run(cat, title, parent, parent === null ? 'Folder' : 'Page');
    return r.lastInsertRowid as number;
}

describe('moveEntrySubtreeToCategory', () => {
    it('moves the entire subtree to the target category', async () => {
        const root = await mkEntry(srcCat, 'root', null);
        const child = await mkEntry(srcCat, 'child', root);
        const grandchild = await mkEntry(srcCat, 'grandchild', child);
        const moved = await moveEntrySubtreeToCategory(dbm, root, dstCat);
        expect(moved).toBe(3);

        const rows = await dbm.prepare(
            'SELECT EntryID, CategoryID, ParentEntryID FROM Entry ORDER BY EntryID'
        ).all() as { EntryID: number; CategoryID: number; ParentEntryID: number | null }[];

        // Everyone is now in the destination category.
        for (const r of rows) expect(r.CategoryID).toBe(dstCat);
        // The root is re-rooted; internal parent links are preserved.
        expect(rows.find(r => r.EntryID === root)!.ParentEntryID).toBeNull();
        expect(rows.find(r => r.EntryID === child)!.ParentEntryID).toBe(root);
        expect(rows.find(r => r.EntryID === grandchild)!.ParentEntryID).toBe(child);

        // No descendant left stranded in the source category.
        const stranded = await dbm.prepare(
            'SELECT COUNT(*) AS n FROM Entry WHERE CategoryID = ?'
        ).get(srcCat) as { n: number };
        expect(stranded.n).toBe(0);
    });

    it('leaves sibling subtrees in the source category untouched', async () => {
        const a = await mkEntry(srcCat, 'A', null);
        await mkEntry(srcCat, 'A-child', a);
        const b = await mkEntry(srcCat, 'B', null);
        await mkEntry(srcCat, 'B-child', b);

        await moveEntrySubtreeToCategory(dbm, a, dstCat);

        const inSrc = await dbm.prepare('SELECT COUNT(*) AS n FROM Entry WHERE CategoryID = ?').get(srcCat) as { n: number };
        const inDst = await dbm.prepare('SELECT COUNT(*) AS n FROM Entry WHERE CategoryID = ?').get(dstCat) as { n: number };
        expect(inSrc.n).toBe(2); // B + B-child stay
        expect(inDst.n).toBe(2); // A + A-child move
    });
});
