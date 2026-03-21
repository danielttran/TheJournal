import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = process.env.JOURNAL_DB_PATH || join(process.cwd(), 'journal.db');
console.log('[DB] Using database at:', dbPath);

class DBManager {
    private instance: Database.Database | null = null;
    private maintenanceTimer: ReturnType<typeof setInterval> | null = null;

    getConnection() {
        if (!this.instance) {
            this.instance = new Database(dbPath);
            this.instance.pragma('journal_mode = WAL');
            this.instance.pragma('foreign_keys = ON');
            // Performance: let SQLite cache more pages in memory (64MB)
            this.instance.pragma('cache_size = -65536');
            // Safety: NORMAL is safe with WAL mode
            this.instance.pragma('synchronous = NORMAL');

            // Auto-migration for SortOrder
            try {
                interface TableInfo { name: string; }
                const cols = this.instance.prepare("PRAGMA table_info(Category)").all() as TableInfo[];
                if (!cols.some(c => c.name === 'SortOrder')) {
                    this.instance.prepare("ALTER TABLE Category ADD COLUMN SortOrder REAL DEFAULT 0").run();
                }
                if (!cols.some(c => c.name === 'Icon')) {
                    this.instance.prepare("ALTER TABLE Category ADD COLUMN Icon TEXT").run();
                }

                const entryCols = this.instance.prepare("PRAGMA table_info(Entry)").all() as TableInfo[];
                if (!entryCols.some(c => c.name === 'Icon')) {
                    this.instance.prepare("ALTER TABLE Entry ADD COLUMN Icon TEXT").run();
                }

                // Migration for IsExpanded in Entry (Notebook Tree State)
                if (!entryCols.some(c => c.name === 'IsExpanded')) {
                    this.instance.prepare("ALTER TABLE Entry ADD COLUMN IsExpanded BOOLEAN DEFAULT 0").run();
                }

                // Migration for ParentEntryID (hierarchical notebooks)
                if (!entryCols.some(c => c.name === 'ParentEntryID')) {
                    this.instance.prepare("ALTER TABLE Entry ADD COLUMN ParentEntryID INTEGER REFERENCES Entry(EntryID) ON DELETE CASCADE").run();
                }

                // Migration for EntryType (Page vs Section)
                if (!entryCols.some(c => c.name === 'EntryType')) {
                    this.instance.prepare("ALTER TABLE Entry ADD COLUMN EntryType TEXT DEFAULT 'Page' CHECK(EntryType IN ('Page', 'Section'))").run();
                }

                // Migration for SortOrder on Entry
                if (!entryCols.some(c => c.name === 'SortOrder')) {
                    this.instance.prepare("ALTER TABLE Entry ADD COLUMN SortOrder REAL DEFAULT 0").run();
                }

                // Migration for Version on Entry (optimistic locking)
                if (!entryCols.some(c => c.name === 'Version')) {
                    this.instance.prepare("ALTER TABLE Entry ADD COLUMN Version INTEGER DEFAULT 1").run();
                }

                // Migration for ViewSettings in Category (Journal Tree State)
                if (!cols.some(c => c.name === 'ViewSettings')) {
                    this.instance.prepare("ALTER TABLE Category ADD COLUMN ViewSettings TEXT").run();
                }

                // Auto-create missing indexes for production scale
                this.ensureIndexes(this.instance);

            } catch (e) {
                console.error('[DB] Migration error:', e);
            }

            // Run initial maintenance
            this.runMaintenance(this.instance);

            // Schedule periodic maintenance every 30 minutes
            this.maintenanceTimer = setInterval(() => {
                if (this.instance) this.runMaintenance(this.instance);
            }, 30 * 60 * 1000);
        }
        return this.instance;
    }

    /**
     * Ensure all required indexes exist for performance at scale.
     * Uses IF NOT EXISTS so it's safe to run repeatedly.
     */
    private ensureIndexes(db: Database.Database) {
        try {
            // ParentEntryID — critical for hierarchical notebook queries
            db.exec('CREATE INDEX IF NOT EXISTS "Idx_Entry_Parent" ON "Entry" ("ParentEntryID")');
            // Composite index for date-based journal lookups
            db.exec('CREATE INDEX IF NOT EXISTS "Idx_Entry_Category_Date" ON "Entry" ("CategoryID", "CreatedDate")');
            // Category user ownership — used in every auth check
            db.exec('CREATE INDEX IF NOT EXISTS "Idx_Category_User" ON "Category" ("UserID")');
            // EntryType + CategoryID for filtered queries
            db.exec('CREATE INDEX IF NOT EXISTS "Idx_Entry_Type" ON "Entry" ("CategoryID", "EntryType")');
            console.log('[DB] Indexes verified');
        } catch (e) {
            console.warn('[DB] Index creation warning:', e);
        }
    }

    /**
     * Self-maintenance: WAL checkpoint, integrity check, and query planner optimization.
     * Safe to run while the database is in use.
     */
    private runMaintenance(db: Database.Database) {
        try {
            // WAL checkpoint — reclaim WAL file space, prevent unbounded growth
            const walResult = db.pragma('wal_checkpoint(PASSIVE)') as any[];
            if (walResult?.[0]) {
                const { busy, checkpointed, log } = walResult[0];
                if (log > 0) {
                    console.log(`[DB Maintenance] WAL checkpoint: ${checkpointed}/${log} pages checkpointed${busy ? ' (some busy)' : ''}`);
                }
            }

            // Optimize — updates query planner statistics without rebuilding
            db.pragma('optimize');

            // Periodic integrity check (lightweight — only checks the first few pages)
            // Full integrity_check is expensive; quick_check is fast
            const integrityResult = db.pragma('quick_check') as any[];
            if (integrityResult?.[0]?.integrity_check !== 'ok' && integrityResult?.[0]?.quick_check !== 'ok') {
                // Check both possible column names
                const resultStr = JSON.stringify(integrityResult?.[0]);
                if (!resultStr.includes('ok')) {
                    console.error('[DB Maintenance] INTEGRITY CHECK FAILED:', integrityResult);
                }
            }
        } catch (e) {
            console.warn('[DB Maintenance] Warning:', e);
        }
    }

    close() {
        if (this.maintenanceTimer) {
            clearInterval(this.maintenanceTimer);
            this.maintenanceTimer = null;
        }
        if (this.instance) {
            // Final WAL checkpoint before closing
            try { this.instance.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* best effort */ }
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = (connection as any)[prop];

        // If the property is a function, bind it to the connection
        if (typeof value === 'function') {
            return value.bind(connection);
        }
        return value;
    }
}) as Database.Database;
