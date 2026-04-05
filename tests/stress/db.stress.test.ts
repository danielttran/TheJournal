/**
 * Database stress tests for TheJournal.
 *
 * Tests are run directly against a real SQLCipher database (a temp file that is
 * created before the suite and deleted after) to exercise the actual AsyncMutex,
 * transaction logic, version checking, and cascade behaviour — exactly as the
 * production API routes exercise them.
 *
 * Coverage:
 *  1. Concurrent by-date creation → exactly 1 entry, no duplicates
 *  2. Optimistic-locking under concurrency → 1 winner, rest get conflicts
 *  3. Sequential saves → version increments monotonically
 *  4. Recursive CTE delete: deep tree (100 levels)
 *  5. Recursive CTE delete: wide tree (500 siblings)
 *  6. Self-parent move guard
 *  7. Cycle-creating move guard (A→B→C, move C under A)
 *  8. Concurrent ViewSettings merge → no lost updates
 *  9. Mutex exclusion → 30 concurrent counter increments, no interleaving
 * 10. Large dataset search (1 000 entries)
 * 11. Cascade delete cleans up EntryContent
 * 12. Rapid entry creation then deletion leaves DB clean
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink, access } from 'fs/promises';
import { DBManager } from '../../src/lib/db';

// ─── Test DB setup ────────────────────────────────────────────────────────────

const TEST_DB_PATH = join(process.cwd(), `test-stress-${Date.now()}.tjdb`);
// Valid 64-hex-char (32-byte) key — never used outside tests
const TEST_KEY = 'deadbeef'.repeat(8);

let dbm: DBManager;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    // Seed a single shared user used by most tests
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (1, ?)').run('test');
});

afterAll(async () => {
    dbm.close();
    // Clean up temp DB files
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {/* may not exist */});
    }
    // Verify cleanup
    await expect(access(TEST_DB_PATH)).rejects.toThrow();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createCategory(type: 'Journal' | 'Notebook' = 'Journal', userId = 1): Promise<number> {
    const r = await dbm.prepare(
        'INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)'
    ).run(userId, `Cat-${Date.now()}-${Math.random()}`, type);
    return r.lastInsertRowid;
}

async function createEntry(categoryId: number, title = 'Entry', parentId: number | null = null): Promise<number> {
    const r = await dbm.prepare(
        'INSERT INTO Entry (CategoryID, Title, PreviewText, ParentEntryID) VALUES (?, ?, ?, ?)'
    ).run(categoryId, title, '', parentId);
    const entryId = r.lastInsertRowid;
    await dbm.prepare(
        'INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent) VALUES (?, ?, ?)'
    ).run(entryId, JSON.stringify({ ops: [{ insert: 'hello\n' }] }), '<p>hello</p>');
    return entryId;
}

/** Same logic as the by-date API route — SELECT-then-INSERT inside BEGIN IMMEDIATE. */
async function getOrCreateByDate(categoryId: number, date: string) {
    const tx = dbm.transaction(async () => {
        const existing = await dbm.prepare(
            `SELECT EntryID FROM Entry WHERE CategoryID = ? AND date(CreatedDate) = ?`
        ).get(categoryId, date) as any;
        if (existing) return { id: existing.EntryID as number, created: false };
        const r = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate) VALUES (?, ?, ?, ?)`
        ).run(categoryId, 'New Entry', '', `${date} 12:00:00`);
        await dbm.prepare(
            'INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent) VALUES (?, ?, ?)'
        ).run(r.lastInsertRowid, '{}', '');
        return { id: r.lastInsertRowid as number, created: true };
    });
    return tx();
}

/** Same logic as the PUT entry route — version check INSIDE transaction. */
async function updateEntry(
    entryId: number,
    html: string,
    expectedVersion: number | undefined
): Promise<{ ok: boolean; newVersion?: number; conflict?: boolean }> {
    let newVersion = 0;
    const tx = dbm.transaction(async () => {
        const row = await dbm.prepare('SELECT Version FROM Entry WHERE EntryID = ?')
            .get(entryId) as { Version: number } | undefined;
        if (!row) throw Object.assign(new Error('not_found'), { status: 404 });
        if (expectedVersion !== undefined && row.Version !== expectedVersion) {
            throw Object.assign(new Error('conflict'), { status: 409 });
        }
        newVersion = (row.Version ?? 1) + 1;
        await dbm.prepare('UPDATE EntryContent SET HtmlContent = ? WHERE EntryID = ?').run(html, entryId);
        await dbm.prepare('UPDATE Entry SET Version = ?, ModifiedDate = CURRENT_TIMESTAMP WHERE EntryID = ?')
            .run(newVersion, entryId);
    });
    try {
        await tx();
        return { ok: true, newVersion };
    } catch (e: any) {
        if (e.status === 409) return { ok: false, conflict: true };
        throw e;
    }
}

/** Deletes the entry subtree using the same recursive CTE as the DELETE route. */
async function deleteSubtree(entryId: number) {
    const tx = dbm.transaction(async () => {
        const rows = await dbm.prepare(`
            WITH RECURSIVE subtree(id) AS (
                SELECT ?
                UNION ALL
                SELECT e.EntryID FROM Entry e JOIN subtree s ON e.ParentEntryID = s.id
            )
            SELECT id FROM subtree
        `).all(entryId) as { id: number }[];
        const ids = rows.map(r => r.id);
        if (ids.length === 0) return;
        const ph = ids.map(() => '?').join(',');
        await dbm.prepare(`DELETE FROM EntryContent WHERE EntryID IN (${ph})`).run(...ids);
        await dbm.prepare(`DELETE FROM Entry WHERE EntryID IN (${ph})`).run(...ids);
    });
    await tx();
}

async function countEntries(categoryId: number): Promise<number> {
    const r = await dbm.prepare('SELECT COUNT(*) as n FROM Entry WHERE CategoryID = ?')
        .get(categoryId) as { n: number };
    return r.n;
}

async function countContent(entryId: number): Promise<number> {
    const r = await dbm.prepare('SELECT COUNT(*) as n FROM EntryContent WHERE EntryID = ?')
        .get(entryId) as { n: number };
    return r.n;
}

// ─── Suite 1: Concurrent by-date creation ─────────────────────────────────────

describe('concurrent by-date creation', () => {
    it('fires 20 simultaneous requests for the same date → exactly 1 entry created', async () => {
        const catId = await createCategory('Journal');
        const date = '2025-01-15';

        const results = await Promise.all(
            Array.from({ length: 20 }, () => getOrCreateByDate(catId, date))
        );

        // Every call must return the same EntryID
        const ids = new Set(results.map(r => r.id));
        expect(ids.size).toBe(1);

        // Exactly 1 row in Entry, 1 in EntryContent
        expect(await countEntries(catId)).toBe(1);
        const contentCount = await dbm.prepare(
            'SELECT COUNT(*) as n FROM EntryContent ec JOIN Entry e ON ec.EntryID = e.EntryID WHERE e.CategoryID = ?'
        ).get(catId) as { n: number };
        expect(contentCount.n).toBe(1);
    });

    it('different dates each create their own entry', async () => {
        const catId = await createCategory('Journal');
        const dates = ['2025-03-01', '2025-03-02', '2025-03-03'];

        await Promise.all(dates.flatMap(d =>
            Array.from({ length: 5 }, () => getOrCreateByDate(catId, d))
        ));

        expect(await countEntries(catId)).toBe(3);
    });
});

// ─── Suite 2: Optimistic locking ──────────────────────────────────────────────

describe('optimistic locking under concurrency', () => {
    it('10 concurrent writes to version 1 → exactly 1 succeeds, 9 conflict', async () => {
        const catId = await createCategory('Notebook');
        const entryId = await createEntry(catId);

        const results = await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
                updateEntry(entryId, `<p>writer-${i}</p>`, 1)
            )
        );

        const wins = results.filter(r => r.ok);
        const conflicts = results.filter(r => r.conflict);

        expect(wins).toHaveLength(1);
        expect(conflicts).toHaveLength(9);
        expect(wins[0].newVersion).toBe(2);

        // DB version should be exactly 2
        const row = await dbm.prepare('SELECT Version FROM Entry WHERE EntryID = ?').get(entryId) as any;
        expect(row.Version).toBe(2);
    });

    it('write without expectedVersion always succeeds regardless of concurrency', async () => {
        const catId = await createCategory('Notebook');
        const entryId = await createEntry(catId);

        const results = await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
                updateEntry(entryId, `<p>force-${i}</p>`, undefined)
            )
        );

        expect(results.every(r => r.ok)).toBe(true);
        // Version should be 11 (initial 1 + 10 increments)
        const row = await dbm.prepare('SELECT Version FROM Entry WHERE EntryID = ?').get(entryId) as any;
        expect(row.Version).toBe(11);
    });
});

// ─── Suite 3: Sequential saves — version monotonicity ─────────────────────────

describe('sequential saves', () => {
    it('50 sequential saves increment version correctly', async () => {
        const catId = await createCategory('Notebook');
        const entryId = await createEntry(catId);

        let version = 1;
        for (let i = 0; i < 50; i++) {
            const r = await updateEntry(entryId, `<p>save-${i}</p>`, version);
            expect(r.ok).toBe(true);
            version = r.newVersion!;
        }

        expect(version).toBe(51);
        const row = await dbm.prepare('SELECT Version FROM Entry WHERE EntryID = ?').get(entryId) as any;
        expect(row.Version).toBe(51);
    });
});

// ─── Suite 4: Recursive delete — deep tree ────────────────────────────────────

describe('recursive delete: deep tree', () => {
    it('deletes a 100-level chain in one shot and leaves no orphans', async () => {
        const catId = await createCategory('Notebook');

        // Build a 100-level chain: root → child → grandchild → …
        let parentId: number | null = null;
        const rootId = await createEntry(catId, 'level-0');
        parentId = rootId;
        for (let i = 1; i < 100; i++) {
            parentId = await createEntry(catId, `level-${i}`, parentId);
        }

        expect(await countEntries(catId)).toBe(100);

        const start = Date.now();
        await deleteSubtree(rootId);
        const elapsed = Date.now() - start;

        expect(await countEntries(catId)).toBe(0);
        // EntryContent should also be gone
        const orphans = await dbm.prepare(
            'SELECT COUNT(*) as n FROM EntryContent ec WHERE ec.EntryID NOT IN (SELECT EntryID FROM Entry)'
        ).get() as { n: number };
        expect(orphans.n).toBe(0);

        // Should complete well within 2 seconds
        expect(elapsed).toBeLessThan(2000);
    });
});

// ─── Suite 5: Recursive delete — wide tree ────────────────────────────────────

describe('recursive delete: wide tree', () => {
    it('deletes root with 500 direct children and cleans up content', async () => {
        const catId = await createCategory('Notebook');
        const rootId = await createEntry(catId, 'root');

        // Batch insert 500 children
        const insertTx = dbm.transaction(async () => {
            for (let i = 0; i < 500; i++) {
                const r = await dbm.prepare(
                    'INSERT INTO Entry (CategoryID, Title, PreviewText, ParentEntryID) VALUES (?, ?, ?, ?)'
                ).run(catId, `child-${i}`, '', rootId);
                await dbm.prepare(
                    'INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent) VALUES (?, ?, ?)'
                ).run(r.lastInsertRowid, '{}', `<p>child ${i}</p>`);
            }
        });
        await insertTx();

        expect(await countEntries(catId)).toBe(501);

        const start = Date.now();
        await deleteSubtree(rootId);
        const elapsed = Date.now() - start;

        expect(await countEntries(catId)).toBe(0);
        const orphans = await dbm.prepare(
            'SELECT COUNT(*) as n FROM EntryContent ec WHERE ec.EntryID NOT IN (SELECT EntryID FROM Entry)'
        ).get() as { n: number };
        expect(orphans.n).toBe(0);

        expect(elapsed).toBeLessThan(3000);
    });
});

// ─── Suite 6: Move guards ──────────────────────────────────────────────────────

describe('move guards', () => {
    async function getParent(entryId: number): Promise<number | null> {
        const r = await dbm.prepare('SELECT ParentEntryID FROM Entry WHERE EntryID = ?')
            .get(entryId) as any;
        return r?.ParentEntryID ?? null;
    }

    async function moveEntry(entryId: number, newParentId: number | null): Promise<void> {
        // Cycle guard — same logic as entry/move/route.ts
        if (newParentId !== null) {
            if (newParentId === entryId) throw new Error('self-parent');
            const cycle = await dbm.prepare(`
                WITH RECURSIVE ancestors(id) AS (
                    SELECT ParentEntryID FROM Entry WHERE EntryID = ?
                    UNION ALL
                    SELECT e.ParentEntryID FROM Entry e JOIN ancestors a ON e.EntryID = a.id
                    WHERE a.id IS NOT NULL
                )
                SELECT 1 FROM ancestors WHERE id = ? LIMIT 1
            `).get(newParentId, entryId) as any;
            if (cycle) throw new Error('cycle');
        }
        await dbm.prepare('UPDATE Entry SET ParentEntryID = ? WHERE EntryID = ?').run(newParentId, entryId);
    }

    it('rejects moving an entry under itself (self-parent)', async () => {
        const catId = await createCategory('Notebook');
        const a = await createEntry(catId, 'A');
        await expect(moveEntry(a, a)).rejects.toThrow('self-parent');
    });

    it('rejects a move that would create a cycle (A→B→C, move A under C)', async () => {
        const catId = await createCategory('Notebook');
        const a = await createEntry(catId, 'A');
        const b = await createEntry(catId, 'B', a);
        const c = await createEntry(catId, 'C', b);

        // Moving A under C would create: C→(parent B)→(parent A)→(parent C) = cycle
        await expect(moveEntry(a, c)).rejects.toThrow('cycle');

        // Verify structure unchanged
        expect(await getParent(b)).toBe(a);
        expect(await getParent(c)).toBe(b);
    });

    it('allows a valid move (leaf to different branch)', async () => {
        const catId = await createCategory('Notebook');
        const root = await createEntry(catId, 'root');
        const branch1 = await createEntry(catId, 'branch1', root);
        const branch2 = await createEntry(catId, 'branch2', root);
        const leaf = await createEntry(catId, 'leaf', branch1);

        // Move leaf from branch1 to branch2 — valid
        await expect(moveEntry(leaf, branch2)).resolves.not.toThrow();
        expect(await getParent(leaf)).toBe(branch2);
    });

    it('allows moving a subtree root to a sibling', async () => {
        const catId = await createCategory('Notebook');
        const root = await createEntry(catId, 'root');
        const a = await createEntry(catId, 'A', root);
        const b = await createEntry(catId, 'B', root);
        const aChild = await createEntry(catId, 'A-child', a);

        // Move A (with its child) under B — not a cycle, valid
        await expect(moveEntry(a, b)).resolves.not.toThrow();
        expect(await getParent(a)).toBe(b);
        expect(await getParent(aChild)).toBe(a); // child's parent unchanged
    });
});

// ─── Suite 7: Concurrent ViewSettings merge ───────────────────────────────────

describe('concurrent ViewSettings merge', () => {
    it('20 concurrent updates each set a unique key — no key lost', async () => {
        const catId = await createCategory();

        // Each concurrent request reads, merges, and writes a different key
        const mergeKey = (key: string, value: string) => dbm.transaction(async () => {
            const row = await dbm.prepare(
                'SELECT ViewSettings FROM Category WHERE CategoryID = ?'
            ).get(catId) as any;
            const settings = row?.ViewSettings ? JSON.parse(row.ViewSettings) : {};
            settings[key] = value;
            await dbm.prepare(
                'UPDATE Category SET ViewSettings = ? WHERE CategoryID = ?'
            ).run(JSON.stringify(settings), catId);
        })();

        await Promise.all(
            Array.from({ length: 20 }, (_, i) => mergeKey(`key${i}`, `val${i}`))
        );

        const row = await dbm.prepare(
            'SELECT ViewSettings FROM Category WHERE CategoryID = ?'
        ).get(catId) as any;
        const final = JSON.parse(row.ViewSettings);

        // Every key must be present — serialised writes mean no clobbering
        for (let i = 0; i < 20; i++) {
            expect(final[`key${i}`]).toBe(`val${i}`);
        }
    });
});

// ─── Suite 8: Mutex exclusion ─────────────────────────────────────────────────

describe('AsyncMutex exclusion', () => {
    it('30 concurrent transactions increment a counter without interleaving', async () => {
        const catId = await createCategory();
        const rootId = await createEntry(catId, 'counter-entry');

        // Use Version column as an atomic counter; each tx reads and increments by 1
        const bumpVersion = () => dbm.transaction(async () => {
            const row = await dbm.prepare('SELECT Version FROM Entry WHERE EntryID = ?')
                .get(rootId) as { Version: number };
            await dbm.prepare('UPDATE Entry SET Version = ? WHERE EntryID = ?')
                .run(row.Version + 1, rootId);
        })();

        await Promise.all(Array.from({ length: 30 }, () => bumpVersion()));

        const row = await dbm.prepare('SELECT Version FROM Entry WHERE EntryID = ?')
            .get(rootId) as { Version: number };
        // Started at 1, incremented 30 times = 31
        expect(row.Version).toBe(31);
    });
});

// ─── Suite 9: Large dataset + search ─────────────────────────────────────────

describe('large dataset', () => {
    it('inserts 1000 entries and retrieves the right subset', async () => {
        const catId = await createCategory('Notebook');
        const NEEDLE = 'aurora-borealis-unique-keyword';

        const insertTx = dbm.transaction(async () => {
            for (let i = 0; i < 1000; i++) {
                const hasNeedle = i % 10 === 0; // 100 of 1000 contain the needle
                const r = await dbm.prepare(
                    'INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)'
                ).run(catId, `Entry ${i}`, hasNeedle ? NEEDLE : `generic text ${i}`);
                await dbm.prepare(
                    'INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent) VALUES (?, ?, ?)'
                ).run(r.lastInsertRowid, '{}', hasNeedle ? `<p>${NEEDLE}</p>` : `<p>text ${i}</p>`);
            }
        });

        const insertStart = Date.now();
        await insertTx();
        const insertMs = Date.now() - insertStart;

        expect(await countEntries(catId)).toBe(1000);
        // Bulk insert should finish in under 5 s
        expect(insertMs).toBeLessThan(5000);

        // Full-table LIKE search — should still be fast for 1 000 rows
        const searchStart = Date.now();
        const rows = await dbm.prepare(`
            SELECT e.EntryID FROM Entry e
            JOIN EntryContent ec ON e.EntryID = ec.EntryID
            WHERE e.CategoryID = ? AND (e.PreviewText LIKE ? OR ec.HtmlContent LIKE ?)
        `).all(catId, `%${NEEDLE}%`, `%${NEEDLE}%`) as any[];
        const searchMs = Date.now() - searchStart;

        expect(rows).toHaveLength(100);
        expect(searchMs).toBeLessThan(500);
    });
});

// ─── Suite 10: Cascade delete integrity ───────────────────────────────────────

describe('cascade delete integrity', () => {
    it('deleting an entry removes its EntryContent row', async () => {
        const catId = await createCategory('Notebook');
        const entryId = await createEntry(catId);

        expect(await countContent(entryId)).toBe(1);
        await deleteSubtree(entryId);
        expect(await countContent(entryId)).toBe(0);
    });

    it('partial delete (middle of chain) leaves parents and children of removed node orphan-free', async () => {
        const catId = await createCategory('Notebook');
        const root = await createEntry(catId, 'root');
        const mid = await createEntry(catId, 'mid', root);
        const leaf = await createEntry(catId, 'leaf', mid);

        // Delete just 'mid' subtree (includes leaf)
        await deleteSubtree(mid);

        // root still exists; mid and leaf gone
        const remaining = await dbm.prepare(
            'SELECT EntryID FROM Entry WHERE CategoryID = ?'
        ).all(catId) as any[];
        expect(remaining.map((r: any) => r.EntryID)).toEqual([root]);

        // No orphaned EntryContent rows
        const orphans = await dbm.prepare(
            'SELECT COUNT(*) as n FROM EntryContent WHERE EntryID NOT IN (SELECT EntryID FROM Entry)'
        ).get() as { n: number };
        expect(orphans.n).toBe(0);
    });
});

// ─── Suite 11: Rapid create → delete cycle ────────────────────────────────────

describe('rapid create and delete', () => {
    it('creates and deletes 200 entries in rapid succession, leaves DB clean', async () => {
        const catId = await createCategory('Notebook');

        // Create 200 entries as fast as possible
        const ids: number[] = [];
        for (let i = 0; i < 200; i++) {
            ids.push(await createEntry(catId, `rapid-${i}`));
        }
        expect(await countEntries(catId)).toBe(200);

        // Delete them all concurrently
        await Promise.all(ids.map(id => deleteSubtree(id)));

        expect(await countEntries(catId)).toBe(0);
        const orphans = await dbm.prepare(
            'SELECT COUNT(*) as n FROM EntryContent WHERE EntryID NOT IN (SELECT EntryID FROM Entry)'
        ).get() as { n: number };
        expect(orphans.n).toBe(0);
    });
});

// ─── Suite 12: Edge cases ─────────────────────────────────────────────────────

describe('edge cases', () => {
    it('deleting a non-existent entry silently succeeds (0 changes, no error)', async () => {
        const tx = dbm.transaction(async () => {
            const rows = await dbm.prepare(`
                WITH RECURSIVE subtree(id) AS (SELECT 9999999 UNION ALL SELECT e.EntryID FROM Entry e JOIN subtree s ON e.ParentEntryID = s.id)
                SELECT id FROM subtree
            `).all() as { id: number }[];
            if (rows.length === 0) return;
            const ids = rows.map(r => r.id);
            const ph = ids.map(() => '?').join(',');
            await dbm.prepare(`DELETE FROM EntryContent WHERE EntryID IN (${ph})`).run(...ids);
            await dbm.prepare(`DELETE FROM Entry WHERE EntryID IN (${ph})`).run(...ids);
        });
        await expect(tx()).resolves.not.toThrow();
    });

    it('by-date on two different categories for the same date creates independent entries', async () => {
        const cat1 = await createCategory('Journal');
        const cat2 = await createCategory('Journal');
        const date = '2025-06-01';

        const [r1, r2] = await Promise.all([
            getOrCreateByDate(cat1, date),
            getOrCreateByDate(cat2, date),
        ]);

        expect(r1.id).not.toBe(r2.id);
        expect(await countEntries(cat1)).toBe(1);
        expect(await countEntries(cat2)).toBe(1);
    });

    it('version conflict returns early without touching EntryContent', async () => {
        const catId = await createCategory('Notebook');
        const entryId = await createEntry(catId);

        // Read the content before attempted conflict update
        const before = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?')
            .get(entryId) as any;

        // This will conflict (wrong version)
        const r = await updateEntry(entryId, '<p>should not land</p>', 999);
        expect(r.conflict).toBe(true);

        // Content should be unchanged
        const after = await dbm.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?')
            .get(entryId) as any;
        expect(after.HtmlContent).toBe(before.HtmlContent);
    });
});
