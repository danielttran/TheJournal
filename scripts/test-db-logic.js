const Database = require('better-sqlite3');
const db = new Database('journal.db');

// Simulate the logic in actions.ts manually to verify DB connection and insert
const email = "test@example.com";
const password = "password123";

try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (user) {
        console.log("User found:", user);
    } else {
        console.log("User not found, creating...");
        const stmt = db.prepare('INSERT INTO users (email, password) VALUES (?, ?)');
        const info = stmt.run(email, password);
        console.log('Created new user:', info.lastInsertRowid);
    }

    // Check again
    const user2 = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    console.log("Verification - User in DB:", user2);

} catch (err) {
    console.error("Error:", err);
}
