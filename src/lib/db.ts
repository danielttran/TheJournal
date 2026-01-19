import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(process.cwd(), 'journal.db');

export const db = new Database(dbPath, { verbose: console.log });
db.pragma('journal_mode = WAL'); // Better performance
