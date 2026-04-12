import { Database } from '@journeyapps/sqlcipher';
import { join } from 'path';

type SQLValue = string | number | bigint | null | Uint8Array;

export class DatabaseNotUnlockedError extends Error {
    constructor() {
        super('Database is not unlocked');
        this.name = 'DatabaseNotUnlockedError';
    }
}

export class AsyncStatement {
    constructor(private db: Database, private query: string) {}

    get<T = unknown>(...params: SQLValue[]): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            this.db.get(this.query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row as T | undefined);
            });
        });
    }

    all<T = unknown>(...params: SQLValue[]): Promise<T[]> {
        return new Promise((resolve, reject) => {
            this.db.all(this.query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows as T[]);
            });
        });
    }

    run(...params: SQLValue[]): Promise<{ lastInsertRowid: number, changes: number }> {
        return new Promise((resolve, reject) => {
            this.db.run(this.query, params, function(this: { lastID: number; changes: number }, err) {
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
                        // Enable foreign key enforcement
                        tempDb.run('PRAGMA foreign_keys = ON');
                        // Wait up to 5 seconds when a lock is held, reducing SQLITE_BUSY failures.
                        tempDb.run('PRAGMA busy_timeout = 5000');
                        this.instance = tempDb;
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
            `CREATE INDEX IF NOT EXISTS "Idx_Template_User" ON "Template" ("UserID")`
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


    prepare(query: string): AsyncStatement {
        if (!this.instance) {
            throw new DatabaseNotUnlockedError();
        }
        return new AsyncStatement(this.instance, query);
    }

    transaction<T, TArgs extends unknown[]>(cb: (...args: TArgs) => Promise<T>): (...args: TArgs) => Promise<T> {
        return async (...args: TArgs) => {
            if (!this.instance) throw new DatabaseNotUnlockedError();
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

interface DBClient {
    prepare: DBManager['prepare'];
    transaction: DBManager['transaction'];
    close: DBManager['close'];
}

export const db: DBClient = new Proxy({} as DBClient, {
    get: (_target, prop: string) => {
        if (prop === 'prepare') return dbManager.prepare.bind(dbManager);
        if (prop === 'transaction') return dbManager.transaction.bind(dbManager);
        if (prop === 'close') return dbManager.close.bind(dbManager);
        return (dbManager as unknown as Record<string, unknown>)[prop];
    }
});
