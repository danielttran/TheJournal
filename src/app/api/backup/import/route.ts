import { join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
    let tempPath = "";

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // 1. Save uploaded file to temp path
        tempPath = join(process.cwd(), `import-${Date.now()}.db`);
        await writeFile(tempPath, buffer);

        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const userId = parseInt(userIdCookie.value, 10);

        // 2. ATTACH the uploaded database
        try {
            db.prepare(`ATTACH DATABASE ? AS imported`).run(tempPath);
        } catch (e: any) {
            console.error("Import: Failed to attach", e);
            throw new Error("Could not read uploaded database file.");
        }

        // 3. Perform Restore Transaction
        const transaction = db.transaction(() => {
            // A. Clear current user's data
            db.prepare('DELETE FROM Category WHERE UserID = ?').run(userId);

            // B. ID Remapping Strategy
            const importedCats = db.prepare("SELECT * FROM imported.Category").all() as any[];
            const idMap = new Map<number, number>(); // OldCatID -> NewCatID

            for (const cat of importedCats) {
                const newCat = db.prepare(`
                    INSERT INTO main.Category (UserID, Name, Color, IsPrivate, Type)
                    VALUES (?, ?, ?, ?, ?)
                 `).run(userId, cat.Name, cat.Color, cat.IsPrivate, cat.Type || 'Journal');

                idMap.set(cat.CategoryID, newCat.lastInsertRowid as number);
            }

            // C. Copy Entries
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

            // D. Copy Content
            const importedContent = db.prepare("SELECT * FROM imported.EntryContent").all() as any[];
            for (const content of importedContent) {
                const newEntryId = entryIdMap.get(content.EntryID);
                if (!newEntryId) continue;

                db.prepare(`
                    INSERT INTO main.EntryContent (EntryID, QuillDelta, HtmlContent)
                    VALUES (?, ?, ?)
                 `).run(newEntryId, content.QuillDelta, content.HtmlContent);
            }

            // E. Fix ParentEntryID (Hierarchy)
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

        // 4. DETACH
        db.prepare("DETACH imported").run();

        // 5. Cleanup
        await unlink(tempPath);

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Import failed", error);

        // Try cleanup
        try { db.prepare("DETACH imported").run(); } catch (e) { }
        try { if (tempPath) await unlink(tempPath); } catch (e) { }

        return NextResponse.json({ error: "Failed to import", details: error.message }, { status: 500 });
    }
}
