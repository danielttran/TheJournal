/**
 * Hierarchical categories — schema + tree integration.
 *
 * Verifies the ParentCategoryID migration landed, a parent round-trips through
 * the DB, deleting a parent promotes children to roots (ON DELETE SET NULL,
 * no cascade), and the pure tree builder nests the persisted rows correctly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { buildCategoryTree, flattenTree, type CategoryNodeInput } from '../../src/lib/categoryTree';

const TEST_DB_PATH = join(process.cwd(), `test-cat-hier-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
let userId: number;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Category').run();
    await dbm.prepare('DELETE FROM User').run();
    const u = await dbm.prepare('INSERT INTO User (Username) VALUES (?)').run('alice');
    userId = Number(u.lastInsertRowid);
});

async function addCat(name: string, parent: number | null, sort: number): Promise<number> {
    const r = await dbm.prepare(
        'INSERT INTO Category (UserID, Name, Type, SortOrder, ParentCategoryID) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, name, 'Notebook', sort, parent);
    return Number(r.lastInsertRowid);
}

describe('Category hierarchy schema', () => {
    it('has a ParentCategoryID column', async () => {
        const cols = await dbm.prepare('PRAGMA table_info(Category)').all() as { name: string }[];
        expect(cols.map(c => c.name)).toContain('ParentCategoryID');
    });

    it('round-trips a parent reference and nests via buildCategoryTree', async () => {
        const root = await addCat('Root', null, 0);
        const child = await addCat('Child', root, 0);
        await addCat('Grandchild', child, 0);

        const rows = await dbm.prepare(
            'SELECT CategoryID, ParentCategoryID, SortOrder, Name FROM Category WHERE UserID = ?'
        ).all(userId) as (CategoryNodeInput & { Name: string })[];

        const tree = buildCategoryTree(rows);
        expect(tree).toHaveLength(1);
        expect(tree[0].category.CategoryID).toBe(root);
        expect(tree[0].children[0].category.CategoryID).toBe(child);
        expect(tree[0].children[0].children[0].category.Name).toBe('Grandchild');
        expect(flattenTree(tree)).toHaveLength(3);
    });

    it('promotes children to roots when their parent is deleted (no cascade)', async () => {
        const root = await addCat('Root', null, 0);
        const child = await addCat('Child', root, 0);

        await dbm.prepare('DELETE FROM Category WHERE CategoryID = ?').run(root);

        const remaining = await dbm.prepare(
            'SELECT CategoryID, ParentCategoryID FROM Category WHERE UserID = ?'
        ).all(userId) as { CategoryID: number; ParentCategoryID: number | null }[];

        // The child survives and is now a root (ParentCategoryID nulled).
        expect(remaining).toEqual([{ CategoryID: child, ParentCategoryID: null }]);
    });
});
