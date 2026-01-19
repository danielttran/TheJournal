const db = require('better-sqlite3')('journal.db');

try {
    console.log('Migrating Entry table...');

    // Add ParentEntryID
    try {
        db.prepare(`ALTER TABLE Entry ADD COLUMN ParentEntryID INTEGER REFERENCES Entry(EntryID) ON DELETE CASCADE`).run();
        console.log('Added ParentEntryID column.');
    } catch (e) {
        if (e.message.includes('duplicate column name')) {
            console.log('ParentEntryID column already exists.');
        } else {
            throw e;
        }
    }

    // Add EntryType
    try {
        db.prepare(`ALTER TABLE Entry ADD COLUMN EntryType TEXT DEFAULT 'Page' CHECK(EntryType IN ('Page', 'Section'))`).run();
        console.log('Added EntryType column.');
    } catch (e) {
        if (e.message.includes('duplicate column name')) {
            console.log('EntryType column already exists.');
        } else {
            throw e;
        }
    }

    console.log('Migration complete.');
} catch (error) {
    console.error('Migration failed:', error);
}
