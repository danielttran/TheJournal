const Database = require('better-sqlite3');
const { pbkdf2Sync, randomBytes, timingSafeEqual } = require('crypto');
const path = require('path');

const dbPath = path.join(__dirname, '../journal.db');
const db = new Database(dbPath);

// Helper from auth.ts (replicated for standalone script)
const ITERATIONS = 600000;
const KEYLEN = 64;
const DIGEST = "sha256";

function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const hash = pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString("hex");
    return { hash, salt, iterations: ITERATIONS };
}

function verifyPassword(password, hash, salt, iterations) {
    const derivedHash = pbkdf2Sync(password, salt, iterations, KEYLEN, DIGEST).toString("hex");
    return derivedHash === hash; // Simplified verification for test script
}

const username = "testuser";
const password = "securepassword";

try {
    // 1. Check if user exists (should be empty initially)
    let user = db.prepare('SELECT * FROM User WHERE Username = ?').get(username);
    if (!user) {
        console.log("User not found as expected. Creating...");
        const { hash, salt, iterations } = hashPassword(password);
        const stmt = db.prepare('INSERT INTO User (Username, PasswordHash, Salt, Iterations) VALUES (?, ?, ?, ?)');
        stmt.run(username, hash, salt, iterations);
    } else {
        console.log("User already exists (legacy run?)");
    }

    // 2. Fetch and Verify
    user = db.prepare('SELECT * FROM User WHERE Username = ?').get(username);
    console.log("Fetched User:", {
        UserID: user.UserID,
        Username: user.Username,
        HashLen: user.PasswordHash.length,
        Salt: user.Salt
    });

    const isMatch = verifyPassword(password, user.PasswordHash, user.Salt, user.Iterations);
    console.log("Password Verification:", isMatch ? "SUCCESS" : "FAILED");

    // 3. Test Foreign Key (Category)
    try {
        const catStmt = db.prepare('INSERT INTO Category (UserID, Name) VALUES (?, ?)');
        const catInfo = catStmt.run(user.UserID, "My Notebook");
        console.log("Created Category ID:", catInfo.lastInsertRowid);

        // Fetch to verify
        const cat = db.prepare('SELECT * FROM Category WHERE CategoryID = ?').get(catInfo.lastInsertRowid);
        console.log("Fetched Category:", cat);

    } catch (e) {
        console.error("Category creation failed:", e);
    }

} catch (err) {
    console.error("Test failed:", err);
}
