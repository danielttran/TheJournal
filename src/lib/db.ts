import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(process.cwd(), 'journal.db');

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
            } catch (e) { console.error("Migration failed", e); }
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

export const dbManager = new DBManager();

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
