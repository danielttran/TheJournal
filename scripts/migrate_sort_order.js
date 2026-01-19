const db = require('better-sqlite3')('journal.db');

try {
    console.log('Migrating Entry table for Drag and Drop...');

    // Add SortOrder
    try {
        db.prepare(`ALTER TABLE Entry ADD COLUMN SortOrder REAL DEFAULT 0`).run();
        console.log('Added SortOrder column.');
    } catch (e) {
        if (e.message.includes('duplicate column name')) {
            console.log('SortOrder column already exists.');
        } else {
            throw e;
        }
    }

    console.log('Migration complete.');
} catch (error) {
    console.error('Migration failed:', error);
}
