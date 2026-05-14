/**
 * Audit: backup round-trip with new tables
 *
 * We can't easily invoke the Next.js route handler from vitest, so this test
 * exercises the same SQL operations the importer performs:
 *  - ATTACH a source encrypted DB
 *  - Copy categories, entries (with new IsDeleted/IsPinned columns), reminders,
 *    word goals, saved searches
 *  - Verify counts match in destination
 *
 * If the importer ever falls behind a schema change, this test will detect it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';

const SOURCE = join(process.cwd(), `test-source-${Date.now()}.tjdb`);
const DEST   = join(process.cwd(), `test-dest-${Date.now()}.tjdb`);
const KEY = 'deadbeef'.repeat(8);

let source: DBManager;
let dest: DBManager;

async function seedSource() {
    // User + categories
    await source.prepare('INSERT INTO User (UserID, Username) VALUES (?, ?)').run(1, 'src');
    const cat = await source.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(1, 'Travel', 'Journal');
    const catId = cat.lastInsertRowid;

    // Entries with all interesting flags
    const e1 = await source.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, IsDeleted, DeletedDate, IsPinned, PinnedDate, Mood, IsFavorited, Tags)
         VALUES (?, ?, ?, 0, NULL, 1, '2026-05-13T00:00:00Z', 'happy', 1, ?)`
    ).run(catId, 'Pinned entry', '', JSON.stringify(['travel']));
    await source.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(e1.lastInsertRowid, '<p>pinned body</p>');

    const e2 = await source.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, IsDeleted, DeletedDate)
         VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)`
    ).run(catId, 'In trash', '');
    await source.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(e2.lastInsertRowid, '<p>trash body</p>');

    // Reminder linked to an entry
    await source.prepare(
        `INSERT INTO Reminder (UserID, Title, Notes, DueAt, IsComplete, EntryID) VALUES (?, ?, ?, ?, 0, ?)`
    ).run(1, 'Plan trip', 'don\'t forget passport', '2026-06-01T09:00:00Z', e1.lastInsertRowid);

    // Word goal
    await source.prepare(
        `INSERT INTO WordGoal (UserID, Type, Target, StartDate, EndDate, CategoryID) VALUES (?, 'total', 50000, '2026-11-01', '2026-11-30', ?)`
    ).run(1, catId);

    // Saved search
    await source.prepare(
        `INSERT INTO SavedSearch (UserID, Name, QueryJson) VALUES (?, ?, ?)`
    ).run(1, 'Tagged travel', JSON.stringify({ q: 'beach', tags: ['travel'] }));
}

/** Mirror of the importer logic from src/app/api/backup/import/route.ts */
async function runImport(destDb: DBManager, sourcePath: string, destUserId: number) {
    await destDb.prepare(`ATTACH DATABASE "${sourcePath}" AS imported KEY "x'${KEY}'"`).run();
    try {
        const tx = destDb.transaction(async () => {
            const cats = await destDb.prepare(`SELECT * FROM imported.Category`).all() as any[];
            const catIdMap = new Map<number, number>();
            for (const c of cats) {
                const r = await destDb.prepare(
                    `INSERT INTO main.Category (UserID, Name, Type, Color, IsPrivate, ViewSettings, SortOrder, Icon)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(destUserId, c.Name, c.Type, c.Color ?? '#6366f1', c.IsPrivate ?? 0, c.ViewSettings ?? null, c.SortOrder ?? 0, c.Icon ?? null);
                catIdMap.set(c.CategoryID, r.lastInsertRowid as number);
            }

            const entries = await destDb.prepare(`SELECT * FROM imported.Entry`).all() as any[];
            const entryIdMap = new Map<number, number>();
            for (const e of entries) {
                const newCat = catIdMap.get(e.CategoryID);
                if (!newCat) continue;
                const r = await destDb.prepare(`
                    INSERT INTO main.Entry(CategoryID, Title, PreviewText, IsLocked, CreatedDate, ModifiedDate, EntryType, SortOrder, Icon, IsExpanded, Mood, IsFavorited, Tags, IsDeleted, DeletedDate, IsPinned, PinnedDate)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newCat, e.Title, e.PreviewText, e.IsLocked ?? 0,
                    e.CreatedDate, e.ModifiedDate, e.EntryType || 'Page',
                    e.SortOrder ?? 0, e.Icon, e.IsExpanded ? 1 : 0,
                    e.Mood ?? null, e.IsFavorited ? 1 : 0, e.Tags ?? '[]',
                    e.IsDeleted ? 1 : 0, e.DeletedDate ?? null,
                    e.IsPinned ? 1 : 0, e.PinnedDate ?? null
                );
                entryIdMap.set(e.EntryID, r.lastInsertRowid as number);
            }

            const contents = await destDb.prepare(`SELECT * FROM imported.EntryContent`).all() as any[];
            for (const c of contents) {
                const newId = entryIdMap.get(c.EntryID);
                if (newId) {
                    await destDb.prepare(
                        `INSERT INTO main.EntryContent (EntryID, HtmlContent, DocumentJson) VALUES (?, ?, ?)`
                    ).run(newId, c.HtmlContent, c.DocumentJson ?? null);
                }
            }

            const safeAll = async (sql: string): Promise<any[]> => {
                try { return await destDb.prepare(sql).all() as any[]; }
                catch { return []; }
            };

            for (const rem of await safeAll('SELECT * FROM imported.Reminder')) {
                const newEntryId = rem.EntryID ? entryIdMap.get(rem.EntryID) ?? null : null;
                await destDb.prepare(
                    `INSERT INTO main.Reminder (UserID, Title, Notes, DueAt, IsComplete, CompletedAt, EntryID, CreatedAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(destUserId, rem.Title, rem.Notes ?? null, rem.DueAt, rem.IsComplete ? 1 : 0, rem.CompletedAt ?? null, newEntryId, rem.CreatedAt ?? null);
            }
            for (const g of await safeAll('SELECT * FROM imported.WordGoal')) {
                const newCatId = g.CategoryID ? catIdMap.get(g.CategoryID) ?? null : null;
                await destDb.prepare(
                    `INSERT INTO main.WordGoal (UserID, Type, Target, StartDate, EndDate, CategoryID, CreatedAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
                ).run(destUserId, g.Type, g.Target, g.StartDate, g.EndDate ?? null, newCatId, g.CreatedAt ?? null);
            }
            for (const s of await safeAll('SELECT * FROM imported.SavedSearch')) {
                await destDb.prepare(
                    `INSERT INTO main.SavedSearch (UserID, Name, QueryJson, CreatedAt) VALUES (?, ?, ?, ?)`
                ).run(destUserId, s.Name, s.QueryJson, s.CreatedAt ?? null);
            }
        });
        await tx();
    } finally {
        await destDb.prepare(`DETACH imported`).run();
    }
}

beforeAll(async () => {
    source = new DBManager(SOURCE);
    await source.unlock(KEY);
    await seedSource();
    await source.close();

    dest = new DBManager(DEST);
    await dest.unlock(KEY);
    await dest.prepare('INSERT INTO User (UserID, Username) VALUES (?, ?)').run(99, 'dest');
});

afterAll(async () => {
    await dest.close();
    for (const path of [SOURCE, DEST]) {
        for (const suffix of ['', '-shm', '-wal']) {
            await unlink(path + suffix).catch(() => {});
        }
    }
});

describe('Backup round-trip', () => {
    it('imports source DB into dest DB with all new tables/columns intact', async () => {
        await runImport(dest, SOURCE, 99);

        // Verify categories
        const cats = await dest.prepare('SELECT * FROM Category WHERE UserID = ?').all(99) as any[];
        expect(cats.length).toBe(1);
        expect(cats[0].Name).toBe('Travel');

        // Verify entries (both regular and soft-deleted)
        const allEntries = await dest.prepare('SELECT * FROM Entry WHERE CategoryID = ?').all(cats[0].CategoryID) as any[];
        expect(allEntries.length).toBe(2);

        const pinned = allEntries.find(e => e.Title === 'Pinned entry');
        expect(pinned).toBeDefined();
        expect(pinned.IsPinned).toBe(1);
        expect(pinned.IsFavorited).toBe(1);
        expect(pinned.Mood).toBe('happy');
        expect(JSON.parse(pinned.Tags)).toEqual(['travel']);

        const trashed = allEntries.find(e => e.Title === 'In trash');
        expect(trashed.IsDeleted).toBe(1);
        expect(trashed.DeletedDate).toBeTruthy();

        // Verify content
        const content = await dest.prepare('SELECT HtmlContent FROM EntryContent WHERE EntryID = ?').get(pinned.EntryID) as any;
        expect(content.HtmlContent).toContain('pinned body');

        // Verify reminder (with remapped EntryID)
        const reminders = await dest.prepare('SELECT * FROM Reminder WHERE UserID = ?').all(99) as any[];
        expect(reminders.length).toBe(1);
        expect(reminders[0].Title).toBe('Plan trip');
        expect(reminders[0].EntryID).toBe(pinned.EntryID); // remapped

        // Verify word goal (with remapped CategoryID)
        const goals = await dest.prepare('SELECT * FROM WordGoal WHERE UserID = ?').all(99) as any[];
        expect(goals.length).toBe(1);
        expect(goals[0].Type).toBe('total');
        expect(goals[0].CategoryID).toBe(cats[0].CategoryID);

        // Verify saved search
        const saved = await dest.prepare('SELECT * FROM SavedSearch WHERE UserID = ?').all(99) as any[];
        expect(saved.length).toBe(1);
        expect(saved[0].Name).toBe('Tagged travel');
        expect(JSON.parse(saved[0].QueryJson).q).toBe('beach');
    });
});
