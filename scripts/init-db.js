const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../journal.db');
const schemaPath = path.join(__dirname, 'schema.sql');

try {
  const db = new Database(dbPath);
  const schema = fs.readFileSync(schemaPath, 'utf8');

  console.log(`Initializing database at ${dbPath}...`);
  db.exec(schema);
  console.log('Database schema applied successfully.');

} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
}
