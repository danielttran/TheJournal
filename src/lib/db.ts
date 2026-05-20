import { Database } from '@journeyapps/sqlcipher';
import { join } from 'path';

type SQLValue = string | number | bigint | null | Uint8Array;

export class DatabaseNotUnlockedError extends Error {
    constructor() {
        super('Database is not unlocked');
        this.name = 'DatabaseNotUnlockedError';
    }
}

/**
 * Prepared statement that auto-resolves the underlying Database from its parent
 * DBManager at execute time — so callers can `dbm.prepare(...).run(...)` even
 * before the connection is unlocked. The first method call will trigger
 * `ensureUnlocked()` and then delegate.
 *
 * This is the core of the mission-critical fix: every entry point can use
 * `dbManager` (or the `db` proxy) safely without coordinating unlock state.
 */
export class AsyncStatement {
    constructor(private dbm: DBManager, private query: string) {}

    /** Lazily ensure unlock + return the underlying SQLCipher handle. */
    private async resolved(): Promise<Database> {
        if (!this.dbm.instance) {
            await this.dbm.ensureUnlocked();
        }
        return this.dbm.instance!;
    }

    async get<T = unknown>(...params: SQLValue[]): Promise<T | undefined> {
        const handle = await this.resolved();
        return new Promise((resolve, reject) => {
            handle.get(this.query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row as T | undefined);
            });
        });
    }

    async all<T = unknown>(...params: SQLValue[]): Promise<T[]> {
        const handle = await this.resolved();
        return new Promise((resolve, reject) => {
            handle.all(this.query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows as T[]);
            });
        });
    }

    async run(...params: SQLValue[]): Promise<{ lastInsertRowid: number, changes: number }> {
        const handle = await this.resolved();
        return new Promise((resolve, reject) => {
            handle.run(this.query, params, function(this: { lastID: number; changes: number }, err) {
                if (err) reject(err);
                else resolve({ lastInsertRowid: this.lastID, changes: this.changes });
            });
        });
    }
}

// Async mutex to serialize DB transactions.
// Without this, concurrent HTTP requests can both issue BEGIN IMMEDIATE before
// either receives a callback, causing SQLITE_ERROR: cannot BEGIN within a transaction.
class AsyncMutex {
    private queue: Array<() => void> = [];
    private locked = false;

    acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => this.queue.push(resolve));
    }

    release(): void {
        const next = this.queue.shift();
        if (next) {
            next();
        } else {
            this.locked = false;
        }
    }
}

export class DBManager {
    public instance: Database | null = null;
    private dbPath: string;
    public currentKey: string | null = null;
    private mutex = new AsyncMutex();

    /** Pass a custom path to create isolated test instances. */
    constructor(customPath?: string) {
        this.dbPath = customPath ?? process.env.JOURNAL_DB_PATH ?? join(process.cwd(), 'journal.tjdb');
    }

    async unlock(hexKey: string, force = false): Promise<void> {
        if (this.instance && !force) return;
        if (this.instance && force) {
            await this.close();
        }

        return new Promise((resolve, reject) => {
            const tempDb = new Database(this.dbPath, (err) => {
                if (err) return reject(err);
                
                // PRAGMAs must be issued in this order:
                // 1. key        — sets the decryption key
                // 2. cipher settings — must be set before any page is read
                // 3. verification SELECT — proves the key is correct
                tempDb.serialize(() => {
                    let pragmaError: Error | null = null;

                    tempDb.run(`PRAGMA key = "x'${hexKey}'"`, (err) => {
                        if (err) pragmaError = err;
                    });
                    tempDb.run('PRAGMA cipher_page_size = 4096', (err) => {
                        if (err) pragmaError = err;
                    });
                    tempDb.run('PRAGMA kdf_iter = 64000', (err) => {
                        if (err) pragmaError = err;
                    });

                    tempDb.get("SELECT count(*) FROM sqlite_master", (err) => {
                        if (pragmaError || err) {
                            tempDb.close();
                            return reject(new Error("Invalid password or database locked"));
                        }
                        // Enable WAL mode so reads don't block writes (reduces concurrency errors)
                        tempDb.run('PRAGMA journal_mode = WAL');
                        // Flush every transaction fully to disk before returning — maximum crash safety
                        tempDb.run('PRAGMA synchronous = FULL');
                        // Enable foreign key enforcement
                        tempDb.run('PRAGMA foreign_keys = ON');
                        // Wait up to 5 seconds when a lock is held, reducing SQLITE_BUSY failures.
                        tempDb.run('PRAGMA busy_timeout = 5000');
                        this.instance = tempDb;
                        this.currentKey = hexKey;
                        this.initSchema()
                            .then(resolve)
                            .catch((schemaErr) => {
                                this.instance = null;
                                tempDb.close(() => reject(schemaErr));
                            });
                    });
                });
            });
        });
    }

    private async initSchema() {
        if (!this.instance) return;
        
        const queries = [
            `CREATE TABLE IF NOT EXISTS User (
                UserID INTEGER PRIMARY KEY AUTOINCREMENT,
                Username TEXT UNIQUE NOT NULL,
                PasswordHash TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS Category (
                CategoryID INTEGER PRIMARY KEY AUTOINCREMENT,
                UserID INTEGER NOT NULL,
                Name TEXT NOT NULL,
                Type TEXT CHECK(Type IN ('Journal', 'Notebook')) NOT NULL,
                Color TEXT DEFAULT '#6366f1',
                IsPrivate BOOLEAN DEFAULT 0,
                ViewSettings TEXT,
                SortOrder REAL DEFAULT 0,
                Icon TEXT,
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS Entry (
                EntryID INTEGER PRIMARY KEY AUTOINCREMENT,
                CategoryID INTEGER NOT NULL,
                Title TEXT NOT NULL,
                PreviewText TEXT,
                IsLocked BOOLEAN DEFAULT 0,
                CreatedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                ModifiedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                Icon TEXT,
                ParentEntryID INTEGER REFERENCES Entry(EntryID) ON DELETE CASCADE,
                IsExpanded BOOLEAN DEFAULT 0,
                EntryType TEXT DEFAULT 'Page' CHECK(EntryType IN ('Page', 'Folder')),
                SortOrder REAL DEFAULT 0,
                Version INTEGER DEFAULT 1,
                FOREIGN KEY (CategoryID) REFERENCES Category(CategoryID) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS EntryContent (
                EntryID INTEGER PRIMARY KEY,
                QuillDelta TEXT,
                HtmlContent TEXT,
                DocumentJson TEXT,
                FOREIGN KEY (EntryID) REFERENCES Entry(EntryID) ON DELETE CASCADE
            )`,
            `CREATE VIRTUAL TABLE IF NOT EXISTS EntrySearch USING fts5(
                Title,
                HtmlContent
            )`,
            `CREATE TABLE IF NOT EXISTS Template (
                TemplateID INTEGER PRIMARY KEY AUTOINCREMENT,
                UserID INTEGER NOT NULL,
                Name TEXT NOT NULL,
                QuillDelta TEXT,
                HtmlContent TEXT,
                DocumentJson TEXT,
                CreatedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS Reminder (
                ReminderID INTEGER PRIMARY KEY AUTOINCREMENT,
                UserID INTEGER NOT NULL,
                Title TEXT NOT NULL,
                Notes TEXT,
                DueAt DATETIME NOT NULL,
                IsComplete BOOLEAN DEFAULT 0,
                CompletedAt DATETIME,
                EntryID INTEGER REFERENCES Entry(EntryID) ON DELETE SET NULL,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS "Idx_Reminder_User_Due" ON "Reminder" ("UserID", "DueAt")`,
            `CREATE TABLE IF NOT EXISTS WordGoal (
                WordGoalID INTEGER PRIMARY KEY AUTOINCREMENT,
                UserID INTEGER NOT NULL,
                Type TEXT NOT NULL CHECK(Type IN ('daily', 'total')),
                Target INTEGER NOT NULL,
                StartDate TEXT NOT NULL,
                EndDate TEXT,
                CategoryID INTEGER REFERENCES Category(CategoryID) ON DELETE CASCADE,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS "Idx_WordGoal_User" ON "WordGoal" ("UserID")`,
            `CREATE TABLE IF NOT EXISTS SavedSearch (
                SavedSearchID INTEGER PRIMARY KEY AUTOINCREMENT,
                UserID INTEGER NOT NULL,
                Name TEXT NOT NULL,
                QueryJson TEXT NOT NULL,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS "Idx_SavedSearch_User" ON "SavedSearch" ("UserID")`,
            // Topics: DavidRM-style colored classification with optional hotkey
            `CREATE TABLE IF NOT EXISTS Topic (
                TopicID INTEGER PRIMARY KEY AUTOINCREMENT,
                UserID INTEGER NOT NULL,
                Name TEXT NOT NULL,
                Color TEXT NOT NULL DEFAULT '#6366f1',
                Hotkey INTEGER,
                SortOrder REAL DEFAULT 0,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE,
                UNIQUE (UserID, Name)
            )`,
            `CREATE INDEX IF NOT EXISTS "Idx_Topic_User" ON "Topic" ("UserID")`,
            `CREATE TABLE IF NOT EXISTS EntryTopic (
                EntryID INTEGER NOT NULL,
                TopicID INTEGER NOT NULL,
                PRIMARY KEY (EntryID, TopicID),
                FOREIGN KEY (EntryID) REFERENCES Entry(EntryID) ON DELETE CASCADE,
                FOREIGN KEY (TopicID) REFERENCES Topic(TopicID) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS "Idx_EntryTopic_Topic" ON "EntryTopic" ("TopicID")`,
            // Habits: daily tracker tied to a user
            `CREATE TABLE IF NOT EXISTS Habit (
                HabitID INTEGER PRIMARY KEY AUTOINCREMENT,
                UserID INTEGER NOT NULL,
                Name TEXT NOT NULL,
                Color TEXT DEFAULT '#10b981',
                Goal INTEGER DEFAULT 1,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS HabitLog (
                HabitID INTEGER NOT NULL,
                Date TEXT NOT NULL,
                Count INTEGER DEFAULT 1,
                PRIMARY KEY (HabitID, Date),
                FOREIGN KEY (HabitID) REFERENCES Habit(HabitID) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS "Idx_Habit_User" ON "Habit" ("UserID")`,
            `CREATE TABLE IF NOT EXISTS Attachment (
                AttachmentID INTEGER PRIMARY KEY AUTOINCREMENT,
                UserID INTEGER NOT NULL,
                Filename TEXT NOT NULL,
                MimeType TEXT NOT NULL,
                Size INTEGER NOT NULL,
                Data BLOB NOT NULL,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS "Idx_Entry_Parent" ON "Entry" ("ParentEntryID")`,
            `CREATE INDEX IF NOT EXISTS "Idx_Entry_Category_Date" ON "Entry" ("CategoryID", "CreatedDate")`,
            `CREATE INDEX IF NOT EXISTS "Idx_Category_User" ON "Category" ("UserID")`,
            `CREATE INDEX IF NOT EXISTS "Idx_Entry_Type" ON "Entry" ("CategoryID", "EntryType")`,
            `CREATE INDEX IF NOT EXISTS "Idx_Template_User" ON "Template" ("UserID")`,
            // Snippets (sprint 6) — kept in main queries array for consistency
            `CREATE TABLE IF NOT EXISTS Snippet (
                SnippetID INTEGER PRIMARY KEY AUTOINCREMENT,
                UserID INTEGER NOT NULL,
                Name TEXT NOT NULL,
                Content TEXT NOT NULL,
                Shortcut TEXT,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS "Idx_Snippet_User_Shortcut" ON "Snippet" ("UserID", "Shortcut")`,
        ];

        for (const query of queries) {
            await new Promise((res, rej) => this.instance!.run(query, (err) => err ? rej(err) : res(null)));
        }

        // Incremental column migrations — safe to run on every startup.
        // ALTER TABLE ADD COLUMN errors are swallowed because the column may already exist on fresh DBs.
        const migrations = [
            `ALTER TABLE Category ADD COLUMN Color TEXT DEFAULT '#6366f1'`,
            `ALTER TABLE Entry ADD COLUMN IsLocked BOOLEAN DEFAULT 0`,
            `ALTER TABLE Entry ADD COLUMN ModifiedDate DATETIME DEFAULT CURRENT_TIMESTAMP`,
            `DROP INDEX IF EXISTS "Idx_Entry_Journal_UniqueDate"`,
            // Add PasswordHash column to User table (nullable so legacy accounts still work)
            `ALTER TABLE User ADD COLUMN PasswordHash TEXT`,
            `ALTER TABLE EntryContent ADD COLUMN DocumentJson TEXT`,
            `ALTER TABLE Template ADD COLUMN DocumentJson TEXT`,
            // Sprint 2: mood, favorites, tags
            `ALTER TABLE Entry ADD COLUMN Mood TEXT`,
            `ALTER TABLE Entry ADD COLUMN IsFavorited BOOLEAN DEFAULT 0`,
            `ALTER TABLE Entry ADD COLUMN Tags TEXT DEFAULT '[]'`,
            // Sprint 3: soft-delete (trash)
            `ALTER TABLE Entry ADD COLUMN IsDeleted BOOLEAN DEFAULT 0`,
            `ALTER TABLE Entry ADD COLUMN DeletedDate DATETIME`,
            `CREATE INDEX IF NOT EXISTS "Idx_Entry_Deleted" ON "Entry" ("IsDeleted", "DeletedDate")`,
            // Sprint 4: pinned entries
            `ALTER TABLE Entry ADD COLUMN IsPinned BOOLEAN DEFAULT 0`,
            `ALTER TABLE Entry ADD COLUMN PinnedDate DATETIME`,
            `CREATE INDEX IF NOT EXISTS "Idx_Entry_Pinned" ON "Entry" ("IsPinned", "PinnedDate")`,
            // Sprint 5: recurring reminders
            `ALTER TABLE Reminder ADD COLUMN RecurInterval TEXT`,
            `ALTER TABLE Reminder ADD COLUMN RecurEvery INTEGER`,
            // Sprint 7: recently-accessed tracking + user settings + backup schedule
            `ALTER TABLE Entry ADD COLUMN LastAccessedDate DATETIME`,
            `CREATE INDEX IF NOT EXISTS "Idx_Entry_LastAccessed" ON "Entry" ("LastAccessedDate")`,
            `CREATE TABLE IF NOT EXISTS UserSetting (
                UserID INTEGER NOT NULL,
                Key TEXT NOT NULL,
                Value TEXT,
                PRIMARY KEY (UserID, Key),
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS BackupSchedule (
                BackupScheduleID INTEGER PRIMARY KEY AUTOINCREMENT,
                UserID INTEGER NOT NULL,
                IntervalDays INTEGER NOT NULL,
                DestPath TEXT NOT NULL,
                LastRun DATETIME,
                Enabled BOOLEAN DEFAULT 1,
                FOREIGN KEY (UserID) REFERENCES User(UserID) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS "Idx_BackupSchedule_User" ON "BackupSchedule" ("UserID")`,
            // DavidRM parity: typed reminders (Appointment/Event/Task/SpecialDay),
            // task status lifecycle, and pre-alert lead time (minutes before DueAt).
            `ALTER TABLE Reminder ADD COLUMN ReminderType TEXT DEFAULT 'Appointment'`,
            `ALTER TABLE Reminder ADD COLUMN Status TEXT DEFAULT 'active'`,
            `ALTER TABLE Reminder ADD COLUMN LeadMinutes INTEGER DEFAULT 0`,
            // DavidRM parity: per-category sort mode for loose-leaf notebooks,
            // auto-insert template, per-category password lock, and journal
            // entry frequency (daily/weekly/hourly).
            `ALTER TABLE Category ADD COLUMN SortMode TEXT DEFAULT 'manual'`,
            `ALTER TABLE Category ADD COLUMN AutoTemplateID INTEGER`,
            `ALTER TABLE Category ADD COLUMN PasswordHash TEXT`,
            `ALTER TABLE Category ADD COLUMN EntryFrequency TEXT DEFAULT 'daily'`,
            // DavidRM parity: Smartbook — a dynamic category that auto-collects
            // entries matching a saved query instead of holding its own entries.
            `ALTER TABLE Category ADD COLUMN IsSmartbook BOOLEAN DEFAULT 0`,
            `ALTER TABLE Category ADD COLUMN SmartbookQuery TEXT`,
            // M2: track which reminders have already fired a notification so
            // the renderer's minute-tick poll doesn't keep firing the same
            // popup forever.
            `ALTER TABLE Reminder ADD COLUMN NotifiedAt DATETIME`,
            // M3.11: per-category passwords (envelope encryption).
            // PasswordHash already exists (added earlier). PasswordSalt + a
            // password-wrapped EEK let us decrypt entry content without ever
            // persisting the plaintext key.
            `ALTER TABLE Category ADD COLUMN PasswordSalt TEXT`,
            `ALTER TABLE Category ADD COLUMN PasswordWrappedKey TEXT`,
            // M6.17: hierarchical topics — Topic gains a nullable parent ref.
            `ALTER TABLE Topic ADD COLUMN ParentTopicID INTEGER REFERENCES Topic(TopicID) ON DELETE SET NULL`,
        ];

        for (const migration of migrations) {
            await new Promise<void>((res) => this.instance!.run(migration, () => res()));
        }

        const ftsSchema = await new Promise<{ sql: string } | undefined>((res) => {
            this.instance!.get(
                `SELECT sql FROM sqlite_master WHERE type='table' AND name='EntrySearch'`,
                (_, row) => res(row as { sql: string } | undefined)
            );
        });
        const isLegacyFts = ftsSchema?.sql?.includes(`content='EntryContent'`) ?? false;
        if (isLegacyFts) {
            await new Promise<void>((res, rej) =>
                this.instance!.run(`DROP TABLE IF EXISTS EntrySearch`, (err) => err ? rej(err) : res())
            );
            await new Promise<void>((res, rej) =>
                this.instance!.run(`CREATE VIRTUAL TABLE EntrySearch USING fts5(Title, HtmlContent)`, (err) => err ? rej(err) : res())
            );
        }

        const ftsSyncQueries = [
            `INSERT INTO EntrySearch(rowid, Title, HtmlContent)
             SELECT e.EntryID, e.Title, COALESCE(ec.HtmlContent, '')
             FROM Entry e
             LEFT JOIN EntryContent ec ON ec.EntryID = e.EntryID
             WHERE NOT EXISTS (SELECT 1 FROM EntrySearch es WHERE es.rowid = e.EntryID)`,
            `CREATE TRIGGER IF NOT EXISTS EntrySearch_Entry_Insert AFTER INSERT ON Entry BEGIN
                INSERT OR REPLACE INTO EntrySearch(rowid, Title, HtmlContent)
                VALUES (
                    NEW.EntryID,
                    NEW.Title,
                    COALESCE((SELECT HtmlContent FROM EntryContent WHERE EntryID = NEW.EntryID), '')
                );
            END;`,
            `CREATE TRIGGER IF NOT EXISTS EntrySearch_Entry_Update AFTER UPDATE OF Title ON Entry BEGIN
                INSERT OR REPLACE INTO EntrySearch(rowid, Title, HtmlContent)
                VALUES (
                    NEW.EntryID,
                    NEW.Title,
                    COALESCE((SELECT HtmlContent FROM EntryContent WHERE EntryID = NEW.EntryID), '')
                );
            END;`,
            `CREATE TRIGGER IF NOT EXISTS EntrySearch_Entry_Delete AFTER DELETE ON Entry BEGIN
                DELETE FROM EntrySearch WHERE rowid = OLD.EntryID;
            END;`,
            `CREATE TRIGGER IF NOT EXISTS EntrySearch_Content_Insert AFTER INSERT ON EntryContent BEGIN
                INSERT OR REPLACE INTO EntrySearch(rowid, Title, HtmlContent)
                VALUES (
                    NEW.EntryID,
                    COALESCE((SELECT Title FROM Entry WHERE EntryID = NEW.EntryID), ''),
                    COALESCE(NEW.HtmlContent, '')
                );
            END;`,
            `CREATE TRIGGER IF NOT EXISTS EntrySearch_Content_Update AFTER UPDATE OF HtmlContent ON EntryContent BEGIN
                INSERT OR REPLACE INTO EntrySearch(rowid, Title, HtmlContent)
                VALUES (
                    NEW.EntryID,
                    COALESCE((SELECT Title FROM Entry WHERE EntryID = NEW.EntryID), ''),
                    COALESCE(NEW.HtmlContent, '')
                );
            END;`,
            `CREATE TRIGGER IF NOT EXISTS EntrySearch_Content_Delete AFTER DELETE ON EntryContent BEGIN
                INSERT OR REPLACE INTO EntrySearch(rowid, Title, HtmlContent)
                VALUES (
                    OLD.EntryID,
                    COALESCE((SELECT Title FROM Entry WHERE EntryID = OLD.EntryID), ''),
                    ''
                );
            END;`
        ];
        for (const query of ftsSyncQueries) {
            await new Promise<void>((res, rej) => this.instance!.run(query, (err) => err ? rej(err) : res()));
        }

        // ── Schema-level migration: Section → Folder CHECK constraint ──────────
        // SQLite does not support ALTER TABLE … DROP CONSTRAINT, so we use the
        // standard 4-step "rename old table / create new / copy / drop old" pattern.
        // This is idempotent: if the constraint already says 'Folder' (fresh DB),
        // the SELECT below returns 0 rows and we skip the rebuild entirely.
        const oldConstraintRow = await new Promise<{ sql: string } | undefined>((res) => {
            this.instance!.get(
                `SELECT sql FROM sqlite_master WHERE type='table' AND name='Entry' AND sql LIKE '%''Section''%'`,
                (_, row) => res(row as { sql: string } | undefined)
            );
        });

        if (oldConstraintRow) {
            // 1. Update any existing 'Section' rows so they survive the copy
            await new Promise<void>((res, rej) =>
                this.instance!.run(`UPDATE Entry SET EntryType = 'Folder' WHERE EntryType = 'Section'`, (err) =>
                    err ? rej(err) : res()
                )
            );

            // 2. Create replacement table with the corrected constraint
            await new Promise<void>((res, rej) =>
                this.instance!.run(`CREATE TABLE IF NOT EXISTS Entry_new (
                    EntryID INTEGER PRIMARY KEY AUTOINCREMENT,
                    CategoryID INTEGER NOT NULL,
                    Title TEXT NOT NULL,
                    PreviewText TEXT,
                    IsLocked BOOLEAN DEFAULT 0,
                    CreatedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                    ModifiedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                    Icon TEXT,
                    ParentEntryID INTEGER REFERENCES Entry_new(EntryID) ON DELETE CASCADE,
                    IsExpanded BOOLEAN DEFAULT 0,
                    EntryType TEXT DEFAULT 'Page' CHECK(EntryType IN ('Page', 'Folder')),
                    SortOrder REAL DEFAULT 0,
                    Version INTEGER DEFAULT 1,
                    FOREIGN KEY (CategoryID) REFERENCES Category(CategoryID) ON DELETE CASCADE
                )`, (err) => err ? rej(err) : res())
            );

            // 3. Copy all rows
            await new Promise<void>((res, rej) =>
                this.instance!.run(`INSERT INTO Entry_new
                    SELECT EntryID, CategoryID, Title, PreviewText, IsLocked,
                           CreatedDate, ModifiedDate, Icon, ParentEntryID, IsExpanded,
                           EntryType, SortOrder, Version
                    FROM Entry`, (err) => err ? rej(err) : res())
            );

            // 4. Swap tables (inside a serialized block so FK checks don't interfere)
            await new Promise<void>((res, rej) =>
                this.instance!.run('PRAGMA foreign_keys = OFF', (err) => err ? rej(err) : res())
            );
            await new Promise<void>((res, rej) =>
                this.instance!.run('DROP TABLE Entry', (err) => err ? rej(err) : res())
            );
            await new Promise<void>((res, rej) =>
                this.instance!.run('ALTER TABLE Entry_new RENAME TO Entry', (err) => err ? rej(err) : res())
            );
            await new Promise<void>((res, rej) =>
                this.instance!.run('PRAGMA foreign_keys = ON', (err) => err ? rej(err) : res())
            );

            // Recreate indexes that were on the old table
            const idxQueries = [
                `CREATE INDEX IF NOT EXISTS "Idx_Entry_Parent" ON "Entry" ("ParentEntryID")`,
                `CREATE INDEX IF NOT EXISTS "Idx_Entry_Category_Date" ON "Entry" ("CategoryID", "CreatedDate")`,
                `CREATE INDEX IF NOT EXISTS "Idx_Entry_Type" ON "Entry" ("CategoryID", "EntryType")`,
            ];
            for (const q of idxQueries) {
                await new Promise<void>((res) => this.instance!.run(q, () => res()));
            }

            console.log('[DB] Migrated Entry table: Section → Folder constraint applied.');
        }
    }


    /**
     * Build a lazy prepared statement. NEVER throws synchronously — the actual
     * unlock + query happens when .get/.all/.run is awaited. This makes every
     * route/page/lib that uses `dbm.prepare(...)` safe under cold-worker
     * conditions (Next.js dev with Turbopack, electron restart, etc.).
     */
    prepare(query: string): AsyncStatement {
        return new AsyncStatement(this, query);
    }

    private _unlockInFlight: Promise<void> | null = null;

    /**
     * Idempotent unlock. Order of preference for the key:
     *   1. Already-unlocked instance → no-op
     *   2. `currentKey` remembered from a prior unlock in this process →
     *      reuse it (covers `close()` + lazy reopen, including dev-time
     *      worker recycle, and test DBs created with a custom key)
     *   3. Fall back to `getAppDbKey()` from auth — only used the very first
     *      time the process opens this DB
     *
     * Reusing the prior key avoids silently rekeying if `JOURNAL_DB_SECRET`
     * changes between an unlock and a reconnect. Concurrent callers are
     * de-duped via `_unlockInFlight` so we never trigger parallel sqlcipher
     * key derivations.
     */
    async ensureUnlocked(): Promise<void> {
        if (this.instance) return;
        if (this._unlockInFlight) return this._unlockInFlight;

        this._unlockInFlight = (async () => {
            const key = this.currentKey ?? (await import('./auth')).getAppDbKey();
            await this.unlock(key);
        })().finally(() => {
            this._unlockInFlight = null;
        });
        return this._unlockInFlight;
    }

    transaction<T, TArgs extends unknown[]>(cb: (...args: TArgs) => Promise<T>): (...args: TArgs) => Promise<T> {
        return async (...args: TArgs) => {
            await this.ensureUnlocked();
            await this.mutex.acquire();
            await this.prepare('BEGIN IMMEDIATE').run();
            try {
                const result = await cb(...args);
                await this.prepare('COMMIT').run();
                return result;
            } catch (err) {
                try { await this.prepare('ROLLBACK').run(); } catch {}
                throw err;
            } finally {
                this.mutex.release();
            }
        };
    }
    
    close(): Promise<void> {
        if (!this.instance) return Promise.resolve();

        const dbToClose = this.instance;
        this.instance = null;
        return new Promise((resolve) => {
            dbToClose.close(() => resolve());
        });
    }
}

const globalForDb = global as unknown as { dbManager: DBManager | undefined };
export const dbManager = globalForDb.dbManager ?? new DBManager();
if (process.env.NODE_ENV !== 'production') globalForDb.dbManager = dbManager;

/**
 * Module-level convenience: ensure the singleton is unlocked. Equivalent to
 * `dbManager.ensureUnlocked()` — exported because some old code may import it.
 */
export async function ensureUnlocked(): Promise<void> {
    return dbManager.ensureUnlocked();
}

interface DBClient {
    prepare: DBManager['prepare'];
    transaction: DBManager['transaction'];
    close: DBManager['close'];
    readonly currentKey: string | null;
}

/**
 * Thin proxy around the singleton — kept for backward compatibility with
 * existing callsites that import `db` (rather than `dbManager`). The underlying
 * `DBManager.prepare/transaction` are already lazy, so this proxy needs no
 * additional unlock logic.
 */
export const db: DBClient = new Proxy({} as DBClient, {
    get: (_target, prop: string) => {
        if (prop === 'prepare') return dbManager.prepare.bind(dbManager);
        if (prop === 'transaction') return dbManager.transaction.bind(dbManager);
        if (prop === 'close') return dbManager.close.bind(dbManager);
        if (prop === 'currentKey') return dbManager.currentKey;
        return (dbManager as unknown as Record<string, unknown>)[prop];
    }
});
