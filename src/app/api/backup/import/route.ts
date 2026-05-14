import { join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds

export async function POST(req: NextRequest) {
    let tempPath = "";
    let ownsTempFile = false;

    try {
        const contentType = req.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            // Electron shortcut: renderer sends { filePath } — the OS path chosen by the user.
            // We read the file directly in the Next.js process (same machine).
            // No base64 encoding / HTTP body size limits to worry about.
            const body = await req.json();
            if (!body?.filePath) {
                return NextResponse.json({ error: 'filePath required' }, { status: 400 });
            }
            tempPath = body.filePath;
            ownsTempFile = false; // don't delete the user's original file
        } else {
            // Web browser: standard FormData file upload
            const formData = await req.formData();
            const file = formData.get('file') as File;
            if (!file) {
                return NextResponse.json({ error: "No file provided" }, { status: 400 });
            }
            const buffer = Buffer.from(await file.arrayBuffer());
            tempPath = join(process.cwd(), `import-${Date.now()}.db`);
            await writeFile(tempPath, buffer);
            ownsTempFile = true;
        }

        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const userId = parseInt(userIdCookie.value, 10);

        // 1. ATTACH the database file
        try {
            const key = db.currentKey;
            if (key) {
                await db.prepare(`ATTACH DATABASE ? AS imported KEY "x'${key}'"`).run(tempPath);
            } else {
                await db.prepare(`ATTACH DATABASE ? AS imported`).run(tempPath);
            }
        } catch (e: any) {
            console.error("Import: Failed to attach", e);
            throw new Error(`Could not read the database file: ${e.message}`);
        }

        // 2. Perform Restore Transaction
        const transaction = db.transaction(async () => {
            // A. Clear current user's data (Attachment has no cascade, must delete explicitly)
            await db.prepare('DELETE FROM Attachment WHERE UserID = ?').run(userId);
            await db.prepare('DELETE FROM Category WHERE UserID = ?').run(userId);

            // B. Remap Categories
            const importedCats = await db.prepare("SELECT * FROM imported.Category").all() as any[];
            const catIdMap = new Map<number, number>();
            for (const cat of importedCats) {
                const r = await db.prepare(`
                    INSERT INTO main.Category (UserID, Name, Color, IsPrivate, Type, Icon, ViewSettings, SortOrder)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(userId, cat.Name, cat.Color, cat.IsPrivate, cat.Type || 'Journal', cat.Icon, cat.ViewSettings, cat.SortOrder || 0);
                catIdMap.set(cat.CategoryID, r.lastInsertRowid as number);
            }

            // C. Remap Entries
            const importedEntries = await db.prepare("SELECT * FROM imported.Entry").all() as any[];
            const entryIdMap = new Map<number, number>();
            for (const entry of importedEntries) {
                const newCatId = catIdMap.get(entry.CategoryID);
                if (!newCatId) continue;
                const r = await db.prepare(`
                    INSERT INTO main.Entry(CategoryID, Title, PreviewText, IsLocked, CreatedDate, ModifiedDate, EntryType, SortOrder, Icon, IsExpanded, Mood, IsFavorited, Tags, IsDeleted, DeletedDate, IsPinned, PinnedDate)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newCatId, entry.Title, entry.PreviewText, entry.IsLocked,
                    entry.CreatedDate, entry.ModifiedDate, entry.EntryType || 'Page',
                    entry.SortOrder || 0, entry.Icon, entry.IsExpanded ? 1 : 0,
                    entry.Mood ?? null, entry.IsFavorited ? 1 : 0, entry.Tags ?? '[]',
                    entry.IsDeleted ? 1 : 0, entry.DeletedDate ?? null,
                    entry.IsPinned ? 1 : 0, entry.PinnedDate ?? null
                );
                entryIdMap.set(entry.EntryID, r.lastInsertRowid as number);
            }

            // D. Remap Attachments (images stored as blobs)
            const attIdMap = new Map<number, number>();
            const importedAtts = await db.prepare("SELECT * FROM imported.Attachment").all() as any[];
            console.log(`[Import] Copying ${importedAtts.length} attachment(s)...`);
            for (const att of importedAtts) {
                const r = await db.prepare(`
                    INSERT INTO main.Attachment (UserID, Filename, MimeType, Size, Data)
                    VALUES (?, ?, ?, ?, ?)
                `).run(userId, att.Filename, att.MimeType, att.Size, att.Data);
                attIdMap.set(att.AttachmentID, r.lastInsertRowid as number);
            }

            // E. Copy EntryContent — rewriting /api/attachment/{oldId} → {newId}
            const importedContent = await db.prepare("SELECT * FROM imported.EntryContent").all() as any[];
            for (const content of importedContent) {
                const newEntryId = entryIdMap.get(content.EntryID);
                if (!newEntryId) continue;

                let html: string = content.HtmlContent ?? '';
                let docJson: string | null = content.DocumentJson ?? null;
                for (const [oldId, newId] of attIdMap) {
                    const oldRef = `/api/attachment/${oldId}`;
                    const newRef = `/api/attachment/${newId}`;
                    html = html.replaceAll(oldRef, newRef);
                    if (docJson) docJson = docJson.replaceAll(oldRef, newRef);
                }

                await db.prepare(`
                    INSERT INTO main.EntryContent(EntryID, HtmlContent, DocumentJson)
                    VALUES(?, ?, ?)
                `).run(newEntryId, html, docJson);
            }

            // F. Fix ParentEntryID hierarchy
            for (const entry of importedEntries) {
                if (entry.ParentEntryID) {
                    const newEntryId = entryIdMap.get(entry.EntryID);
                    const newParentId = entryIdMap.get(entry.ParentEntryID);
                    if (newEntryId && newParentId) {
                        await db.prepare("UPDATE main.Entry SET ParentEntryID = ? WHERE EntryID = ?")
                            .run(newParentId, newEntryId);
                    }
                }
            }

            // G. Import Reminders / WordGoals / SavedSearches (tables added post-launch — safe to skip if absent)
            const safeAll = async (sql: string): Promise<any[]> => {
                try { return await db.prepare(sql).all() as any[]; }
                catch { return []; }
            };
            const importedReminders = await safeAll("SELECT * FROM imported.Reminder");
            for (const rem of importedReminders) {
                const newEntryId = rem.EntryID ? entryIdMap.get(rem.EntryID) ?? null : null;
                await db.prepare(`
                    INSERT INTO main.Reminder(UserID, Title, Notes, DueAt, IsComplete, CompletedAt, EntryID, CreatedAt, RecurInterval, RecurEvery)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    userId, rem.Title, rem.Notes ?? null, rem.DueAt,
                    rem.IsComplete ? 1 : 0, rem.CompletedAt ?? null, newEntryId, rem.CreatedAt ?? null,
                    rem.RecurInterval ?? null, rem.RecurEvery ?? null
                );
            }
            const importedGoals = await safeAll("SELECT * FROM imported.WordGoal");
            for (const g of importedGoals) {
                const newCatId = g.CategoryID ? catIdMap.get(g.CategoryID) ?? null : null;
                await db.prepare(`
                    INSERT INTO main.WordGoal(UserID, Type, Target, StartDate, EndDate, CategoryID, CreatedAt)
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                `).run(userId, g.Type, g.Target, g.StartDate, g.EndDate ?? null, newCatId, g.CreatedAt ?? null);
            }
            const importedSearches = await safeAll("SELECT * FROM imported.SavedSearch");
            for (const s of importedSearches) {
                await db.prepare(`
                    INSERT INTO main.SavedSearch(UserID, Name, QueryJson, CreatedAt)
                    VALUES(?, ?, ?, ?)
                `).run(userId, s.Name, s.QueryJson, s.CreatedAt ?? null);
            }

            console.log(`[Import] Done. ${importedCats.length} categories, ${importedEntries.length} entries, ${importedAtts.length} attachments, ${importedReminders.length} reminders, ${importedGoals.length} goals.`);
        });

        await transaction();

        // 3. DETACH
        await db.prepare("DETACH imported").run();

        // 4. Cleanup (only if we wrote the temp file)
        if (ownsTempFile && tempPath) await unlink(tempPath);

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Import failed:", error);
        try { await db.prepare("DETACH imported").run(); } catch { }
        try { if (ownsTempFile && tempPath) await unlink(tempPath); } catch { }
        return NextResponse.json({ error: "Failed to import", details: error.message }, { status: 500 });
    }
}
