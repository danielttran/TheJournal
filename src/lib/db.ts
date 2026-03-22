import { Database } from '@journeyapps/sqlcipher';
import { join } from 'path';
import { redirect } from 'next/navigation';

export class AsyncStatement {
    constructor(private db: Database, private query: string) {}

    get(...params: any[]): Promise<any> {
        return new Promise((resolve, reject) => {
            this.db.get(this.query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(...params: any[]): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(this.query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    run(...params: any[]): Promise<{ lastInsertRowid: number, changes: number }> {
        return new Promise((resolve, reject) => {
            this.db.run(this.query, params, function(this: any, err) {
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

class DBManager {
    public instance: Database | null = null;
    private dbPath: string;
    private mutex = new AsyncMutex();

    constructor() {
        this.dbPath = process.env.JOURNAL_DB_PATH || join(process.cwd(), 'journal.db');
    }

    async unlock(hexKey: string): Promise<void> {
        if (this.instance) return;

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
                        this.instance = tempDb;
                        this.initSchema().then(resolve).catch(reject);
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
                Username TEXT UNIQUE NOT NULL
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
                EntryType TEXT DEFAULT 'Page' CHECK(EntryType IN ('Page', 'Section')),
                SortOrder REAL DEFAULT 0,
                Version INTEGER DEFAULT 1,
                FOREIGN KEY (CategoryID) REFERENCES Category(CategoryID) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS EntryContent (
                EntryID INTEGER PRIMARY KEY,
                QuillDelta TEXT,
                HtmlContent TEXT,
                FOREIGN KEY (EntryID) REFERENCES Entry(EntryID) ON DELETE CASCADE
            )`,
            `CREATE VIRTUAL TABLE IF NOT EXISTS EntrySearch USING fts5(
                Title,
                HtmlContent,
                content='EntryContent',
                content_rowid='EntryID'
            )`,
            `CREATE INDEX IF NOT EXISTS "Idx_Entry_Parent" ON "Entry" ("ParentEntryID")`,
            `CREATE INDEX IF NOT EXISTS "Idx_Entry_Category_Date" ON "Entry" ("CategoryID", "CreatedDate")`,
            `CREATE INDEX IF NOT EXISTS "Idx_Category_User" ON "Category" ("UserID")`,
            `CREATE INDEX IF NOT EXISTS "Idx_Entry_Type" ON "Entry" ("CategoryID", "EntryType")`
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
        ];
        for (const migration of migrations) {
            await new Promise<void>((res) => this.instance!.run(migration, () => res()));
        }
    }

    prepare(query: string): AsyncStatement {
        if (!this.instance) {
            redirect('/login');
        }
        return new AsyncStatement(this.instance, query);
    }
    
    transaction<T>(cb: (...args: any[]) => Promise<T>): (...args: any[]) => Promise<T> {
        return async (...args: any[]) => {
            if (!this.instance) redirect('/login');
            await this.mutex.acquire();
            await this.prepare('BEGIN IMMEDIATE').run();
            try {
                const result = await cb(...args);
                await this.prepare('COMMIT').run();
                return result;
            } catch (err) {
                try { await this.prepare('ROLLBACK').run(); } catch (_) {}
                throw err;
            } finally {
                this.mutex.release();
            }
        };
    }
    
    close() {
        if (this.instance) {
            this.instance.close();
            this.instance = null;
        }
    }
}

const globalForDb = global as unknown as { dbManager: DBManager | undefined };
export const dbManager = globalForDb.dbManager ?? new DBManager();
if (process.env.NODE_ENV !== 'production') globalForDb.dbManager = dbManager;

export const db = new Proxy({} as any, {
    get: (target, prop: string) => {
        if (prop === 'prepare') return dbManager.prepare.bind(dbManager);
        if (prop === 'transaction') return dbManager.transaction.bind(dbManager);
        if (prop === 'close') return dbManager.close.bind(dbManager);
        return (dbManager as any)[prop];
    }
});
