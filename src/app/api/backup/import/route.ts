import { join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
    const logs: string[] = [];
    const log = (msg: string, ...args: any[]) => {
        try {
            const fullMsg = msg + " " + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
            console.log(fullMsg);
            logs.push(fullMsg);
        } catch (e) {
            logs.push(msg);
        }
    };

    let tempPath = "";

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        log(`Import: Received file, size: ${buffer.length} bytes`);

        // 1. Save uploaded file to temp path
        tempPath = join(process.cwd(), `import-${Date.now()}.db`);
        await writeFile(tempPath, buffer);
        log(`Import: Written to ${tempPath}`);

        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const userId = parseInt(userIdCookie.value, 10);

        // 2. ATTACH the uploaded database
        // This allows us to query it using SQL without closing our main connection
        try {
            db.prepare(`ATTACH DATABASE ? AS imported`).run(tempPath);
            log("Import: Attached uploaded DB as 'imported'");
        } catch (e: any) {
            log("Import: Failed to attach", e);
            throw new Error("Could not read uploaded database file.");
        }

        // 3. Perform Restore Transaction
        const transaction = db.transaction(() => {
            // A. Clear current user's data
            // (Cascading deletes should handle Entries/Contents if Schema is correct, but let's be safe)
            const deleted = db.prepare('DELETE FROM Category WHERE UserID = ?').run(userId);
            log(`Import: Wiped ${deleted.changes} existing categories for user ${userId}`);

            // B. Analyze Imported Schema
            const catCols = db.prepare("PRAGMA imported.table_info(Category)").all() as any[];
            const entryCols = db.prepare("PRAGMA imported.table_info(Entry)").all() as any[];
            const hasEntryUser = entryCols.some(c => c.name === 'UserID');

            // C. Copy Categories
            // We select directly from imported, effectively copying the rows.
            // We force the UserID to be the current user's ID
            const insertCat = db.prepare(`
                INSERT INTO main.Category (Name, Color, IsPrivate, Type)
                SELECT Name, Color, IsPrivate, Type 
                FROM imported.Category
            `);
            // Wait, simply selecting * inserts them with their OLD IDs if we specify rowid, 
            // or generates NEW IDs if we don't.
            // If we generate NEW IDs, we break the Entry->Category links unless we map them.

            // COMPLEXITY: We need to preserve the relationship between Entry and Category.
            // Best approach: Read from Imported into memory, map IDs, Write to Main.
            // OR: Copy them as-is assuming they don't collide? No, auto-increment will collision.

            // Strategy: ID Remapping in Memory (safe and robust)

            const importedCats = db.prepare("SELECT * FROM imported.Category").all() as any[];
            const idMap = new Map<number, number>(); // OldCatID -> NewCatID

            for (const cat of importedCats) {
                const newCat = db.prepare(`
                    INSERT INTO main.Category (UserID, Name, Color, IsPrivate, Type)
                    VALUES (?, ?, ?, ?, ?)
                 `).run(userId, cat.Name, cat.Color, cat.IsPrivate, cat.Type || 'Journal');

                idMap.set(cat.CategoryID, newCat.lastInsertRowid as number);
            }
            log(`Import: Restore ${importedCats.length} Categories`);

            // D. Copy Entries
            const importedEntries = db.prepare("SELECT * FROM imported.Entry").all() as any[];
            const entryIdMap = new Map<number, number>(); // OldEntryID -> NewEntryID

            for (const entry of importedEntries) {
                const newCatId = idMap.get(entry.CategoryID);
                if (!newCatId) continue; // Orphaned entry

                const newEntry = db.prepare(`
                    INSERT INTO main.Entry (CategoryID, Title, PreviewText, IsLocked, CreatedDate, ModifiedDate, EntryType, SortOrder)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newCatId,
                    entry.Title,
                    entry.PreviewText,
                    entry.IsLocked,
                    entry.CreatedDate,
                    entry.ModifiedDate,
                    entry.EntryType || 'Page',
                    entry.SortOrder || 0
                );

                entryIdMap.set(entry.EntryID, newEntry.lastInsertRowid as number);
            }
            log(`Import: Restored ${importedEntries.length} Entries`);

            // E. Copy Content
            // EntryContent is linked 1:1 to Entry
            const importedContent = db.prepare("SELECT * FROM imported.EntryContent").all() as any[];
            for (const content of importedContent) {
                const newEntryId = entryIdMap.get(content.EntryID);
                if (!newEntryId) continue;

                db.prepare(`
                    INSERT INTO main.EntryContent (EntryID, QuillDelta, HtmlContent)
                    VALUES (?, ?, ?)
                 `).run(newEntryId, content.QuillDelta, content.HtmlContent);
            }

            // F. Fix ParentEntryID (Hierarchy)
            // Now that all entries exist, we can re-link parents
            for (const entry of importedEntries) {
                if (entry.ParentEntryID) {
                    const newEntryId = entryIdMap.get(entry.EntryID);
                    const newParentId = entryIdMap.get(entry.ParentEntryID);

                    if (newEntryId && newParentId) {
                        db.prepare("UPDATE main.Entry SET ParentEntryID = ? WHERE EntryID = ?")
                            .run(newParentId, newEntryId);
                    }
                }
            }
        });

        transaction();
        log("Import: Transaction committed");

        // 4. DETACH
        db.prepare("DETACH imported").run();
        log("Import: Detached");

        // 5. Cleanup
        await unlink(tempPath);

        return NextResponse.json({ success: true, logs });

    } catch (error: any) {
        log("Import: Critical Error", error.message);

        // Try cleanup
        try { db.prepare("DETACH imported").run(); } catch (e) { }
        try { if (tempPath) await unlink(tempPath); } catch (e) { }

        return NextResponse.json({ error: "Failed to import", logs, details: error.message }, { status: 500 });
    }
}
