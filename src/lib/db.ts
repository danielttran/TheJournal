import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = process.env.JOURNAL_DB_PATH || join(process.cwd(), 'journal.db');
console.log('[DB] Using database at:', dbPath);

class DBManager {
    private instance: Database.Database | null = null;

    getConnection() {
        if (!this.instance) {
            this.instance = new Database(dbPath);
            this.instance.pragma('journal_mode = WAL');
            this.instance.pragma('foreign_keys = ON');

            // Auto-migration for SortOrder
            try {
                const cols = this.instance.prepare("PRAGMA table_info(Category)").all() as any[];
                if (!cols.some(c => c.name === 'SortOrder')) {
                    this.instance.prepare("ALTER TABLE Category ADD COLUMN SortOrder REAL DEFAULT 0").run();
                }
                if (!cols.some(c => c.name === 'Icon')) {
                    this.instance.prepare("ALTER TABLE Category ADD COLUMN Icon TEXT").run();
                }

                const entryCols = this.instance.prepare("PRAGMA table_info(Entry)").all() as any[];
                if (!entryCols.some(c => c.name === 'Icon')) {
                    this.instance.prepare("ALTER TABLE Entry ADD COLUMN Icon TEXT").run();
                }

                // Migration for IsExpanded in Entry (Notebook Tree State)
                if (!entryCols.some(c => c.name === 'IsExpanded')) {
                    this.instance.prepare("ALTER TABLE Entry ADD COLUMN IsExpanded BOOLEAN DEFAULT 0").run();
                }

                // Migration for ViewSettings in Category (Journal Tree State)
                if (!cols.some(c => c.name === 'ViewSettings')) {
                    this.instance.prepare("ALTER TABLE Category ADD COLUMN ViewSettings TEXT").run();
                }

            } catch (e) { /* silent migrate */ }
        }
        return this.instance;
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

// Proxy to ensure backward compatibility and auto-reopen
export const db = new Proxy({}, {
    get: (target, prop) => {
        const connection = dbManager.getConnection();
        const value = (connection as any)[prop];

        // If the property is a function, bind it to the connection
        if (typeof value === 'function') {
            return value.bind(connection);
        }
        return value;
    }
}) as Database.Database;
