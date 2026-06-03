/**
 * Audit: schema migration idempotency
 *  - Re-unlocking the same DB runs migrations again — must not error or duplicate columns
 *  - All new columns appear after first unlock
 *  - All new tables appear after first unlock
 */
import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sqlite3 from '@journeyapps/sqlcipher';

const TEST_DB_PATH = join(process.cwd(), `test-migration-${Date.now()}.tjdb`);
const LEGACY_DB_PATH = join(process.cwd(), `test-legacy-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);

afterAll(async () => {
    for (const base of [TEST_DB_PATH, LEGACY_DB_PATH]) {
        for (const suffix of ['', '-shm', '-wal']) {
            await unlink(base + suffix).catch(() => {});
        }
    }
});

/** Seed a raw SQLCipher DB with the pre-rename schema: Entry carries the old
 *  CHECK(EntryType IN ('Page','Section')) constraint and the FTS triggers that
 *  reference Entry. Returns once written + closed. */
function seedLegacyDb(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(path);
        const run = (sql: string) => new Promise<void>((res, rej) => db.run(sql, (e: Error | null) => e ? rej(e) : res()));
        (async () => {
            await run(`PRAGMA key = "x'${TEST_KEY}'"`);
            await run(`CREATE TABLE User (UserID INTEGER PRIMARY KEY AUTOINCREMENT, Username TEXT)`);
            await run(`CREATE TABLE Category (CategoryID INTEGER PRIMARY KEY AUTOINCREMENT, UserID INTEGER, Name TEXT, Type TEXT)`);
            await run(`CREATE TABLE Entry (
                EntryID INTEGER PRIMARY KEY AUTOINCREMENT, CategoryID INTEGER NOT NULL, Title TEXT NOT NULL,
                PreviewText TEXT, IsLocked BOOLEAN DEFAULT 0, CreatedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                ModifiedDate DATETIME DEFAULT CURRENT_TIMESTAMP, Icon TEXT,
                ParentEntryID INTEGER REFERENCES Entry(EntryID) ON DELETE CASCADE, IsExpanded BOOLEAN DEFAULT 0,
                EntryType TEXT DEFAULT 'Page' CHECK(EntryType IN ('Page', 'Section')), SortOrder REAL DEFAULT 0,
                Version INTEGER DEFAULT 1, Mood TEXT, IsFavorited BOOLEAN DEFAULT 0, Tags TEXT DEFAULT '[]',
                IsDeleted BOOLEAN DEFAULT 0, DeletedDate DATETIME, IsPinned BOOLEAN DEFAULT 0, PinnedDate DATETIME,
                LastAccessedDate DATETIME,
                FOREIGN KEY (CategoryID) REFERENCES Category(CategoryID) ON DELETE CASCADE)`);
            await run(`CREATE TABLE EntryContent (EntryID INTEGER PRIMARY KEY, QuillDelta TEXT, HtmlContent TEXT, DocumentJson TEXT)`);
            await run(`CREATE VIRTUAL TABLE EntrySearch USING fts5(Title, HtmlContent)`);
            await run(`CREATE TRIGGER EntrySearch_Content_Insert AFTER INSERT ON EntryContent BEGIN
                INSERT OR REPLACE INTO EntrySearch(rowid,Title,HtmlContent)
                VALUES (NEW.EntryID, COALESCE((SELECT Title FROM Entry WHERE EntryID=NEW.EntryID),''), COALESCE(NEW.HtmlContent,'')); END;`);
            await run(`INSERT INTO User (UserID,Username) VALUES (1,'legacy')`);
            await run(`INSERT INTO Category (UserID,Name,Type) VALUES (1,'Diary','Journal')`);
            await run(`INSERT INTO Entry (CategoryID,Title,EntryType,Mood,Tags,IsPinned,IsFavorited) VALUES (1,'My Folder','Section','happy','["a","b"]',1,1)`);
            await run(`INSERT INTO Entry (CategoryID,Title,EntryType,Mood,IsDeleted) VALUES (1,'A Page','Page','sad',1)`);
        })().then(() => db.close((e: Error | null) => e ? reject(e) : resolve())).catch(reject);
    });
}

describe('Schema migrations', () => {
    it('creates all expected tables on a fresh DB', async () => {
        const dbm = new DBManager(TEST_DB_PATH);
        await dbm.unlock(TEST_KEY);
        const rows = await dbm.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
        ).all() as { name: string }[];
        const names = new Set(rows.map(r => r.name));
        for (const t of ['User', 'Category', 'Entry', 'EntryContent', 'Template', 'Attachment', 'Reminder', 'WordGoal', 'SavedSearch']) {
            expect(names.has(t), `missing table ${t}`).toBe(true);
        }
        await dbm.close();
    });

    it('adds Sprint 3/4 columns to Entry on a fresh DB', async () => {
        const dbm = new DBManager(TEST_DB_PATH);
        await dbm.unlock(TEST_KEY);
        const cols = await dbm.prepare(`PRAGMA table_info(Entry)`).all() as { name: string }[];
        const names = new Set(cols.map(c => c.name));
        for (const col of ['IsDeleted', 'DeletedDate', 'IsPinned', 'PinnedDate', 'Mood', 'IsFavorited', 'Tags']) {
            expect(names.has(col), `missing column ${col}`).toBe(true);
        }
        await dbm.close();
    });

    it('is idempotent: re-running migrations does not error', async () => {
        // Open + close + reopen exercises the migration loop a second time.
        const dbm1 = new DBManager(TEST_DB_PATH);
        await dbm1.unlock(TEST_KEY);
        await dbm1.close();
        const dbm2 = new DBManager(TEST_DB_PATH);
        await expect(dbm2.unlock(TEST_KEY)).resolves.not.toThrow();
        const cols = await dbm2.prepare(`PRAGMA table_info(Entry)`).all() as { name: string }[];
        // Sanity check: column count is stable (no duplicate adds)
        const idCount = cols.filter(c => c.name === 'IsDeleted').length;
        expect(idCount).toBe(1);
        await dbm2.close();
    });

    it('opens a legacy Section-constraint DB without crashing and preserves data', async () => {
        // Regression: the FTS triggers reference Entry, so the Section→Folder
        // table rebuild (DROP Entry + RENAME Entry_new) threw "no such table:
        // main.Entry" — bricking the app on startup for legacy DBs. And the old
        // rebuild dropped every ALTER-added column (Mood/Tags/Pin/Favorite/…),
        // losing that data. Both must be fixed.
        await seedLegacyDb(LEGACY_DB_PATH);

        const dbm = new DBManager(LEGACY_DB_PATH);
        await expect(dbm.unlock(TEST_KEY)).resolves.not.toThrow();

        // Constraint migrated, Section rows mapped to Folder.
        const ddl = await dbm.prepare(`SELECT sql FROM sqlite_master WHERE name='Entry'`).get() as { sql: string };
        expect(ddl.sql).toContain("'Folder'");
        expect(ddl.sql).not.toContain("'Section'");
        const sections = await dbm.prepare(`SELECT COUNT(*) AS n FROM Entry WHERE EntryType='Section'`).get() as { n: number };
        expect(sections.n).toBe(0);

        // Rich metadata on both rows survived the rebuild (no data loss).
        const folder = await dbm.prepare(`SELECT EntryType, Mood, Tags, IsPinned, IsFavorited FROM Entry WHERE EntryID=1`).get() as Record<string, unknown>;
        expect(folder).toMatchObject({ EntryType: 'Folder', Mood: 'happy', Tags: '["a","b"]', IsPinned: 1, IsFavorited: 1 });
        const page = await dbm.prepare(`SELECT EntryType, Mood, IsDeleted FROM Entry WHERE EntryID=2`).get() as Record<string, unknown>;
        expect(page).toMatchObject({ EntryType: 'Page', Mood: 'sad', IsDeleted: 1 });

        // FTS triggers were recreated and still fire after the rebuild.
        await dbm.prepare(`INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (2, 'searchable text')`).run();
        const hit = await dbm.prepare(`SELECT COUNT(*) AS n FROM EntrySearch WHERE EntrySearch MATCH 'searchable'`).get() as { n: number };
        expect(hit.n).toBe(1);

        // Idempotent: reopening doesn't re-run or error (constraint is now Folder).
        await dbm.close();
        const dbm2 = new DBManager(LEGACY_DB_PATH);
        await expect(dbm2.unlock(TEST_KEY)).resolves.not.toThrow();
        await dbm2.close();
    });

    it('indexes are created without duplicates', async () => {
        const dbm = new DBManager(TEST_DB_PATH);
        await dbm.unlock(TEST_KEY);
        const rows = await dbm.prepare(
            `SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name`
        ).all() as { name: string }[];
        const names = rows.map(r => r.name);
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        expect(dupes).toEqual([]);
        for (const idx of ['Idx_Entry_Deleted', 'Idx_Entry_Pinned', 'Idx_Reminder_User_Due', 'Idx_WordGoal_User', 'Idx_SavedSearch_User']) {
            expect(names).toContain(idx);
        }
        await dbm.close();
    });
});
