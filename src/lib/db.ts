import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(process.cwd(), 'journal.db');

class DBManager {
    private instance: Database.Database | null = null;

    getConnection() {
        if (!this.instance) {
            this.instance = new Database(dbPath, { verbose: console.log });
            this.instance.pragma('journal_mode = WAL');
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
