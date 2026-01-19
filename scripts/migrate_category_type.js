const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../src/lib/journal.db'); // Adjust path if needed, assuming default assumed loc
// Wait, checking db.ts for actual location. usually it's process.env.DB_PATH or similar.
// Let's assume default for now, or check db.ts content if I verified it. 
// I previously saw db.ts. Let's look at logs... 
// DB is initialized in lib/db.ts.

const db = new Database('journal.db'); // Default location often root or specified.

console.log('Migrating Category table...');

try {
    db.prepare("ALTER TABLE Category ADD COLUMN Type TEXT DEFAULT 'Journal'").run();
    console.log('Added Type column to Category.');
} catch (err) {
    if (err.message.includes('duplicate column name')) {
        console.log('Column Type already exists.');
    } else {
        console.error('Error adding Type column:', err);
    }
}

console.log('Migration complete.');
