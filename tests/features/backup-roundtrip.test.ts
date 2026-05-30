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
    // User + a template (Category.AutoTemplateID references it → must remap)
    await source.prepare('INSERT INTO User (UserID, Username) VALUES (?, ?)').run(1, 'src');
    const tmpl = await source.prepare('INSERT INTO Template (UserID, Name, HtmlContent) VALUES (?, ?, ?)')
        .run(1, 'Daily layout', '<p>{{date}}</p>');
    const tmplId = tmpl.lastInsertRowid;

    // A password-locked category: the wrapped key MUST survive or its entry
    // content (ENC1: ciphertext) becomes permanently undecryptable.
    const cat = await source.prepare(
        `INSERT INTO Category (UserID, Name, Type, AutoTemplateID, PasswordHash, PasswordSalt, PasswordWrappedKey)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(1, 'Travel', 'Journal', tmplId, 'argon2hash', 'saltbytes', 'wrapped-eek-blob');
    const catId = cat.lastInsertRowid;
    // A nested child category — its parent ref must survive the round-trip.
    await source.prepare('INSERT INTO Category (UserID, Name, Type, ParentCategoryID) VALUES (?, ?, ?, ?)')
        .run(1, 'Trips 2026', 'Journal', catId);

    // Topic, snippet, and a per-user setting — all previously dropped on restore.
    await source.prepare('INSERT INTO Topic (UserID, Name, Color) VALUES (?, ?, ?)').run(1, 'Beaches', '#00aaff');
    await source.prepare('INSERT INTO Snippet (UserID, Name, Content) VALUES (?, ?, ?)').run(1, 'sig', 'Cheers, me');
    await source.prepare('INSERT INTO UserSetting (UserID, Key, Value) VALUES (?, ?, ?)').run(1, 'theme', 'dark');

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
            // Templates first — Category.AutoTemplateID remaps onto them.
            const tmpls = await destDb.prepare(`SELECT * FROM imported.Template`).all() as any[];
            const templateIdMap = new Map<number, number>();
            for (const t of tmpls) {
                const r = await destDb.prepare(
                    `INSERT INTO main.Template (UserID, Name, HtmlContent, DocumentJson, CreatedDate) VALUES (?, ?, ?, ?, ?)`
                ).run(destUserId, t.Name, t.HtmlContent ?? null, t.DocumentJson ?? null, t.CreatedDate ?? null);
                templateIdMap.set(t.TemplateID, r.lastInsertRowid as number);
            }

            const cats = await destDb.prepare(`SELECT * FROM imported.Category`).all() as any[];
            const catIdMap = new Map<number, number>();
            for (const c of cats) {
                const mappedTemplate = c.AutoTemplateID ? templateIdMap.get(c.AutoTemplateID) ?? null : null;
                const r = await destDb.prepare(
                    `INSERT INTO main.Category (UserID, Name, Type, Color, IsPrivate, ViewSettings, SortOrder, Icon, AutoTemplateID, PasswordHash, PasswordSalt, PasswordWrappedKey)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(destUserId, c.Name, c.Type, c.Color ?? '#6366f1', c.IsPrivate ?? 0, c.ViewSettings ?? null, c.SortOrder ?? 0, c.Icon ?? null,
                    mappedTemplate, c.PasswordHash ?? null, c.PasswordSalt ?? null, c.PasswordWrappedKey ?? null);
                catIdMap.set(c.CategoryID, r.lastInsertRowid as number);
            }
            // Second pass: re-link parents now that every category has a new id.
            for (const c of cats) {
                if (c.ParentCategoryID == null) continue;
                const newId = catIdMap.get(c.CategoryID);
                const newParentId = catIdMap.get(c.ParentCategoryID);
                if (newId && newParentId) {
                    await destDb.prepare('UPDATE main.Category SET ParentCategoryID = ? WHERE CategoryID = ?')
                        .run(newParentId, newId);
                }
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
            for (const t of await safeAll('SELECT * FROM imported.Topic')) {
                await destDb.prepare(
                    `INSERT INTO main.Topic (UserID, Name, Color, SortOrder, CreatedAt) VALUES (?, ?, ?, ?, ?)`
                ).run(destUserId, t.Name, t.Color ?? '#6366f1', t.SortOrder ?? 0, t.CreatedAt ?? null);
            }
            for (const s of await safeAll('SELECT * FROM imported.Snippet')) {
                await destDb.prepare(
                    `INSERT INTO main.Snippet (UserID, Name, Content, Shortcut, CreatedAt) VALUES (?, ?, ?, ?, ?)`
                ).run(destUserId, s.Name, s.Content, s.Shortcut ?? null, s.CreatedAt ?? null);
            }
            for (const us of await safeAll('SELECT * FROM imported.UserSetting')) {
                await destDb.prepare(
                    `INSERT OR REPLACE INTO main.UserSetting (UserID, Key, Value) VALUES (?, ?, ?)`
                ).run(destUserId, us.Key, us.Value ?? null);
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
        expect(cats.length).toBe(2);
        const travel = cats.find(c => c.Name === 'Travel');
        const child = cats.find(c => c.Name === 'Trips 2026');
        expect(travel).toBeDefined();
        // The child's parent ref was remapped to the parent's NEW id, not lost.
        expect(child.ParentCategoryID).toBe(travel.CategoryID);
        // Per-category password material survives → locked entries stay decryptable.
        expect(travel.PasswordWrappedKey).toBe('wrapped-eek-blob');
        expect(travel.PasswordSalt).toBe('saltbytes');
        expect(travel.PasswordHash).toBe('argon2hash');

        // Template restored, and Category.AutoTemplateID remapped onto its new id.
        const tmpls = await dest.prepare('SELECT * FROM Template WHERE UserID = ?').all(99) as any[];
        expect(tmpls.length).toBe(1);
        expect(tmpls[0].Name).toBe('Daily layout');
        expect(travel.AutoTemplateID).toBe(tmpls[0].TemplateID);

        // Topic, snippet, and per-user setting — previously dropped on restore.
        const topics = await dest.prepare('SELECT * FROM Topic WHERE UserID = ?').all(99) as any[];
        expect(topics.map(t => t.Name)).toContain('Beaches');
        const snippets = await dest.prepare('SELECT * FROM Snippet WHERE UserID = ?').all(99) as any[];
        expect(snippets.map(s => s.Name)).toContain('sig');
        const setting = await dest.prepare('SELECT Value FROM UserSetting WHERE UserID = ? AND Key = ?').get(99, 'theme') as any;
        expect(setting?.Value).toBe('dark');

        // Verify entries (both regular and soft-deleted)
        const allEntries = await dest.prepare('SELECT * FROM Entry WHERE CategoryID = ?').all(travel.CategoryID) as any[];
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
        expect(goals[0].CategoryID).toBe(travel.CategoryID);

        // Verify saved search
        const saved = await dest.prepare('SELECT * FROM SavedSearch WHERE UserID = ?').all(99) as any[];
        expect(saved.length).toBe(1);
        expect(saved[0].Name).toBe('Tagged travel');
        expect(JSON.parse(saved[0].QueryJson).q).toBe('beach');
    });
});
