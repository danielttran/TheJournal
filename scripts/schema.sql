-- ==========================================
-- 1. DATABASE SAFETY & CONFIGURATION
-- ==========================================
-- Run these PRAGMAs every time you connect to the database.
PRAGMA foreign_keys = ON;  -- Enforce relationships (prevent orphans)
PRAGMA journal_mode = WAL; -- Write-Ahead Logging (prevents corruption, allows concurrent reads)
PRAGMA synchronous = NORMAL; -- Good balance of speed and safety in WAL mode
PRAGMA encoding = "UTF-8"; -- Ensure text is stored correctly

BEGIN TRANSACTION;

-- ==========================================
-- 2. USER & AUTHENTICATION
-- ==========================================
DROP TABLE IF EXISTS "User";
CREATE TABLE "User" (
    "UserID" INTEGER PRIMARY KEY AUTOINCREMENT,
    "Username" TEXT UNIQUE NOT NULL COLLATE NOCASE,
    -- Security: Store Hash, not password. Ideally Argon2 or PBKDF2.
    "PasswordHash" TEXT NOT NULL, 
    "Salt" TEXT NOT NULL,
    "Iterations" INTEGER DEFAULT 600000,
    "CreatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 3. ORGANIZATION (Categories/Notebooks)
-- ==========================================
DROP TABLE IF EXISTS "Category";
CREATE TABLE "Category" (
    "CategoryID" INTEGER PRIMARY KEY AUTOINCREMENT,
    "UserID" INTEGER NOT NULL,
    "Name" TEXT NOT NULL,
    "Color" TEXT DEFAULT '#FFFFFF', -- e.g., for UI tagging
    "IsPrivate" BOOLEAN DEFAULT 1,
    FOREIGN KEY("UserID") REFERENCES "User"("UserID") ON DELETE CASCADE
);

-- ==========================================
-- 4. ENTRY METADATA (Lightweight)
-- ==========================================
-- This table is small and fast. Load this for your sidebar list.
DROP TABLE IF EXISTS "Entry";
CREATE TABLE "Entry" (
    "EntryID" INTEGER PRIMARY KEY AUTOINCREMENT,
    "CategoryID" INTEGER NOT NULL,
    "Title" TEXT,
    "PreviewText" TEXT, -- First 100 chars of text for the UI list
    "IsLocked" BOOLEAN DEFAULT 0, -- If true, require password to view content
    "CreatedDate" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "ModifiedDate" DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("CategoryID") REFERENCES "Category"("CategoryID") ON DELETE CASCADE
);

-- ==========================================
-- 5. ENTRY CONTENT (QuillJS Storage)
-- ==========================================
-- Kept separate so you don't load 10MB of text just to render the list.
DROP TABLE IF EXISTS "EntryContent";
CREATE TABLE "EntryContent" (
    "EntryID" INTEGER PRIMARY KEY,
    
    -- The raw Quill Delta JSON. Use this to load the editor.
    -- Example: {"ops":[{"insert":"Hello World\\n"}]}
    "QuillDelta" TEXT NOT NULL, 
    
    -- The raw HTML (Optional). Useful for exporting to PDF/Web without Quill.
    "HtmlContent" TEXT,

    FOREIGN KEY("EntryID") REFERENCES "Entry"("EntryID") ON DELETE CASCADE
);

-- ==========================================
-- 6. FULL TEXT SEARCH (FTS5)
-- ==========================================
-- This creates a hidden virtual table that indexes your text for lightning fast search.
-- You query this table using: SELECT * FROM EntrySearch WHERE EntrySearch MATCH 'query';
DROP TABLE IF EXISTS "EntrySearch";
CREATE VIRTUAL TABLE "EntrySearch" USING fts5(
    EntryID UNINDEXED, 
    Title, 
    BodyText -- Store pure plain text here (no JSON formatting)
);

-- ==========================================
-- 7. TRIGGERS (Automation)
-- ==========================================

-- Trigger: Automatically update ModifiedDate when an Entry changes
CREATE TRIGGER IF NOT EXISTS UpdateEntryTimestamp 
AFTER UPDATE ON Entry
BEGIN
    UPDATE Entry SET ModifiedDate = CURRENT_TIMESTAMP WHERE EntryID = NEW.EntryID;
END;

-- Trigger: Keep Search Index in sync with Content
-- When EntryContent changes, update the FTS table
CREATE TRIGGER IF NOT EXISTS UpdateSearchIndex_Insert
AFTER INSERT ON EntryContent
BEGIN
    INSERT INTO EntrySearch (EntryID, Title, BodyText) 
    SELECT NEW.EntryID, (SELECT Title FROM Entry WHERE EntryID = NEW.EntryID), NEW.QuillDelta; 
    -- Note: Ideally, your App logic inserts the 'Plain Text' version into BodyText, not the JSON.
END;

CREATE TRIGGER IF NOT EXISTS UpdateSearchIndex_Delete
AFTER DELETE ON Entry
BEGIN
    DELETE FROM EntrySearch WHERE EntryID = OLD.EntryID;
END;

-- ==========================================
-- 8. INDEXES (Performance)
-- ==========================================
CREATE INDEX "Idx_Entry_Category" ON "Entry" ("CategoryID");
CREATE INDEX "Idx_Entry_Created" ON "Entry" ("CreatedDate");
CREATE INDEX "Idx_Entry_Modified" ON "Entry" ("ModifiedDate");

COMMIT;
