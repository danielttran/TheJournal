import { join, extname, resolve } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/route-helpers';
import { remapAttachmentRefs, remapEntryRefs } from '@/lib/attachmentRefs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds

// Serialize imports process-wide: ATTACH/DETACH run on the shared singleton
// connection outside the DB mutex and both use the fixed alias `imported`, so
// two concurrent imports would collide (the second ATTACH fails and an error
// handler's `DETACH imported` could detach the other import's database). A
// simple promise chain makes imports run one-at-a-time.
let importChain: Promise<void> = Promise.resolve();
async function acquireImportLock(): Promise<() => void> {
    const prior = importChain;
    let release!: () => void;
    importChain = new Promise<void>((r) => { release = r; });
    await prior;
    return release;
}

export async function POST(req: NextRequest) {
    const releaseImportLock = await acquireImportLock();
    let tempPath = "";
    let ownsTempFile = false;

    try {
        // Authenticate before touching the request body, the filesystem, or the
        // DB — an unauthenticated request must not be able to write a temp file
        // or resolve a server path.
        const userId = getUserIdFromRequest(req);
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const contentType = req.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            // Electron shortcut: renderer sends { filePath } — the OS path chosen by the user.
            // We read the file directly in the Next.js process (same machine).
            // No base64 encoding / HTTP body size limits to worry about.
            //
            // Desktop-only: this branch ATTACHes an arbitrary server-side path
            // with the app's master key (which decrypts the whole multi-tenant
            // DB). On web self-host that would let any authenticated user import
            // every other user's data by pointing at the live journal.tjdb, so
            // the branch is refused unless we're the Electron-embedded server.
            if (process.env.JOURNAL_DESKTOP !== '1') {
                return NextResponse.json({ error: 'filePath import is not available on web; upload the file instead' }, { status: 400 });
            }
            const body = await req.json();
            if (!body?.filePath || typeof body.filePath !== 'string') {
                return NextResponse.json({ error: 'filePath required' }, { status: 400 });
            }
            // Defense in depth: same constraint as the read-file-for-import
            // IPC. A compromised renderer can't redirect this endpoint at an
            // unrelated file expecting it to be a SQLCipher database.
            const resolved = resolve(body.filePath);
            if (extname(resolved).toLowerCase() !== '.tjdb') {
                return NextResponse.json({ error: 'filePath must be a .tjdb file' }, { status: 400 });
            }
            tempPath = resolved;
            ownsTempFile = false; // don't delete the user's original file
        } else {
            // Web browser: standard FormData file upload
            const formData = await req.formData();
            const file = formData.get('file') as File;
            if (!file) {
                return NextResponse.json({ error: "No file provided" }, { status: 400 });
            }
            const buffer = Buffer.from(await file.arrayBuffer());
            // tmpdir() is always writable; process.cwd() is the app install
            // directory in packaged Electron, which is read-only on
            // macOS/Windows. Writing there would crash the import.
            tempPath = join(tmpdir(), `thejournal-import-${Date.now()}-${process.pid}.tjdb`);
            await writeFile(tempPath, buffer);
            ownsTempFile = true;
        }

        // 1. ATTACH the database file
        try {
            const key = db.currentKey;
            if (key) {
                // Defensive: key must be lowercase hex; reject anything else before embedding.
                // (Key is internal — sourced from OS keychain — but interpolation deserves a guard.)
                if (!/^[0-9a-f]+$/i.test(key)) {
                    throw new Error('Invalid database key format');
                }
                await db.prepare(`ATTACH DATABASE ? AS imported KEY "x'${key}'"`).run(tempPath);
            } else {
                await db.prepare(`ATTACH DATABASE ? AS imported`).run(tempPath);
            }
        } catch (e: unknown) {
            console.error("Import: Failed to attach", e);
            throw new Error('Could not read the database file');
        }

        // Row shapes from the attached imported DB. These mirror the table
        // schemas in src/lib/db.ts — keep in sync if a column is added.
        interface ImportedCategoryRow {
            CategoryID: number; Name: string; Color: string | null; IsPrivate: number;
            Type: string | null; Icon: string | null; ViewSettings: string | null;
            SortOrder: number | null; ParentCategoryID: number | null;
            // Restoring these is what keeps password-locked categories decryptable
            // and preserves per-category view config. Older backups may lack some
            // columns (SELECT * yields undefined → coalesced to null on insert).
            SortMode: string | null; AutoTemplateID: number | null; EntryFrequency: string | null;
            WeekStartDay: number | null;
            IsSmartbook: number | null; SmartbookQuery: string | null;
            PasswordHash: string | null; PasswordSalt: string | null; PasswordWrappedKey: string | null;
        }
        interface ImportedTemplateRow {
            TemplateID: number; Name: string; QuillDelta: string | null;
            HtmlContent: string | null; DocumentJson: string | null; CreatedDate: string | null;
        }
        interface ImportedTopicRow {
            TopicID: number; Name: string; Color: string | null; Hotkey: number | null;
            SortOrder: number | null; CreatedAt: string | null; ParentTopicID: number | null;
        }
        interface ImportedEntryTopicRow { EntryID: number; TopicID: number; }
        interface ImportedHabitRow {
            HabitID: number; Name: string; Color: string | null; Goal: number | null; CreatedAt: string | null;
        }
        interface ImportedHabitLogRow { HabitID: number; Date: string; Count: number | null; }
        interface ImportedSnippetRow {
            Name: string; Content: string; Shortcut: string | null; CreatedAt: string | null;
        }
        interface ImportedUserSettingRow { Key: string; Value: string | null; }
        interface ImportedBackupScheduleRow {
            IntervalDays: number; DestPath: string; LastRun: string | null; Enabled: number | null;
        }
        interface ImportedEntryRow {
            EntryID: number; CategoryID: number; Title: string; PreviewText: string | null;
            IsLocked: number; CreatedDate: string; ModifiedDate: string;
            EntryType: string | null; SortOrder: number | null; Icon: string | null;
            IsExpanded: number; Mood: string | null; IsFavorited: number;
            Tags: string | null; IsDeleted: number; DeletedDate: string | null;
            IsPinned: number; PinnedDate: string | null; ParentEntryID: number | null;
            LastAccessedDate: string | null;
        }
        interface ImportedAttachmentRow {
            AttachmentID: number; Filename: string; MimeType: string; Size: number; Data: Buffer;
        }
        interface ImportedContentRow {
            EntryID: number; HtmlContent: string | null; DocumentJson: string | null;
        }
        interface ImportedReminderRow {
            ReminderID: number;
            Title: string; Notes: string | null; DueAt: string; IsComplete: number;
            CompletedAt: string | null; EntryID: number | null; CreatedAt: string | null;
            RecurInterval: string | null; RecurEvery: number | null;
            ReminderType: string | null; Status: string | null;
            LeadMinutes: number | null; NotifiedAt: string | null;
            NextOccurrenceID: number | null;
        }
        interface ImportedGoalRow {
            Type: string; Target: number; StartDate: string; EndDate: string | null;
            CategoryID: number | null; CreatedAt: string | null;
        }
        interface ImportedSavedSearchRow {
            Name: string; QueryJson: string; CreatedAt: string | null;
        }

        // Validate the attached file is actually a TheJournal database BEFORE the
        // destructive delete. Restoring a foreign/corrupt file must never wipe
        // the user's existing data — fail loudly instead.
        const coreTables = await db.prepare(
            `SELECT name FROM imported.sqlite_master WHERE type='table' AND name IN ('Category','Entry','EntryContent')`
        ).all() as { name: string }[];
        if (coreTables.length < 3) {
            throw new Error('Selected file is not a valid TheJournal backup.');
        }

        // 2. Perform Restore Transaction
        const transaction = db.transaction(async () => {
            // Optional tables (added post-launch / absent in old backups). Reading
            // a missing imported.<table> throws; treat as "nothing to restore".
            const safeAll = async <T>(sql: string): Promise<T[]> => {
                try { return await db.prepare(sql).all() as T[]; }
                catch { return []; }
            };

            // A. Clear ALL of the current user's data so restore REPLACES rather
            // than duplicates. Child rows cascade: Category→Entry→EntryContent,
            // Category/Topic→EntryTopic, Habit→HabitLog.
            for (const t of ['Attachment', 'Category', 'Topic', 'Template', 'Snippet',
                'Habit', 'Reminder', 'WordGoal', 'SavedSearch', 'UserSetting', 'BackupSchedule']) {
                await db.prepare(`DELETE FROM ${t} WHERE UserID = ?`).run(userId);
            }

            // B. Templates first — Category.AutoTemplateID references them.
            const importedTemplates = await safeAll<ImportedTemplateRow>("SELECT * FROM imported.Template");
            const templateIdMap = new Map<number, number>();
            for (const t of importedTemplates) {
                const r = await db.prepare(`
                    INSERT INTO main.Template (UserID, Name, QuillDelta, HtmlContent, DocumentJson, CreatedDate)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(userId, t.Name, t.QuillDelta ?? null, t.HtmlContent ?? null, t.DocumentJson ?? null, t.CreatedDate ?? null);
                templateIdMap.set(t.TemplateID, r.lastInsertRowid as number);
            }

            // C. Categories — all columns, incl. per-category password material
            // (without PasswordWrappedKey, locked entries would be undecryptable).
            const importedCats = await db.prepare("SELECT * FROM imported.Category").all() as ImportedCategoryRow[];
            const catIdMap = new Map<number, number>();
            for (const cat of importedCats) {
                const mappedTemplate = cat.AutoTemplateID ? templateIdMap.get(cat.AutoTemplateID) ?? null : null;
                const r = await db.prepare(`
                    INSERT INTO main.Category
                        (UserID, Name, Color, IsPrivate, Type, Icon, ViewSettings, SortOrder,
                         SortMode, AutoTemplateID, EntryFrequency, WeekStartDay, IsSmartbook, SmartbookQuery,
                         PasswordHash, PasswordSalt, PasswordWrappedKey)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    userId, cat.Name, cat.Color, cat.IsPrivate, cat.Type || 'Journal', cat.Icon,
                    cat.ViewSettings, cat.SortOrder || 0,
                    cat.SortMode ?? null, mappedTemplate, cat.EntryFrequency ?? null,
                    cat.WeekStartDay ?? 0,
                    cat.IsSmartbook ?? 0, cat.SmartbookQuery ?? null,
                    cat.PasswordHash ?? null, cat.PasswordSalt ?? null, cat.PasswordWrappedKey ?? null
                );
                catIdMap.set(cat.CategoryID, r.lastInsertRowid as number);
            }
            // Re-link the category hierarchy in a second pass: parents may have
            // been inserted after their children, so the new parent id is only
            // known once every category has a row. Dangling refs stay null.
            for (const cat of importedCats) {
                if (cat.ParentCategoryID == null) continue;
                const newId = catIdMap.get(cat.CategoryID);
                const newParentId = catIdMap.get(cat.ParentCategoryID);
                if (newId && newParentId) {
                    await db.prepare('UPDATE main.Category SET ParentCategoryID = ? WHERE CategoryID = ?')
                        .run(newParentId, newId);
                }
            }

            // C2. Smartbook source-category ids: SmartbookQuery is JSON like
            // {"categoryIds":[2,5]} naming the categories a smartbook collects
            // from. Those ids were just remapped (catIdMap), so rewrite them or the
            // restored smartbook would collect from the wrong categories / none.
            for (const cat of importedCats) {
                if (!cat.SmartbookQuery) continue;
                const newId = catIdMap.get(cat.CategoryID);
                if (!newId) continue;
                let parsed: { categoryIds?: number[] } & Record<string, unknown>;
                try { parsed = JSON.parse(cat.SmartbookQuery); } catch { continue; }
                if (!Array.isArray(parsed.categoryIds)) continue;
                parsed.categoryIds = parsed.categoryIds
                    .map((id) => catIdMap.get(id))
                    .filter((id): id is number => typeof id === 'number');
                await db.prepare('UPDATE main.Category SET SmartbookQuery = ? WHERE CategoryID = ?')
                    .run(JSON.stringify(parsed), newId);
            }

            // D. Topics (hierarchical) — second pass re-links ParentTopicID.
            const importedTopics = await safeAll<ImportedTopicRow>("SELECT * FROM imported.Topic");
            const topicIdMap = new Map<number, number>();
            for (const t of importedTopics) {
                const r = await db.prepare(`
                    INSERT INTO main.Topic (UserID, Name, Color, Hotkey, SortOrder, CreatedAt)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(userId, t.Name, t.Color ?? '#6366f1', t.Hotkey ?? null, t.SortOrder ?? 0, t.CreatedAt ?? null);
                topicIdMap.set(t.TopicID, r.lastInsertRowid as number);
            }
            for (const t of importedTopics) {
                if (t.ParentTopicID == null) continue;
                const newId = topicIdMap.get(t.TopicID);
                const newParentId = topicIdMap.get(t.ParentTopicID);
                if (newId && newParentId) {
                    await db.prepare('UPDATE main.Topic SET ParentTopicID = ? WHERE TopicID = ?')
                        .run(newParentId, newId);
                }
            }

            // E. Entries.
            const importedEntries = await db.prepare("SELECT * FROM imported.Entry").all() as ImportedEntryRow[];
            const entryIdMap = new Map<number, number>();
            for (const entry of importedEntries) {
                const newCatId = catIdMap.get(entry.CategoryID);
                if (!newCatId) continue;
                const r = await db.prepare(`
                    INSERT INTO main.Entry(CategoryID, Title, PreviewText, IsLocked, CreatedDate, ModifiedDate, EntryType, SortOrder, Icon, IsExpanded, Mood, IsFavorited, Tags, IsDeleted, DeletedDate, IsPinned, PinnedDate, LastAccessedDate)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newCatId, entry.Title, entry.PreviewText, entry.IsLocked,
                    entry.CreatedDate, entry.ModifiedDate, entry.EntryType || 'Page',
                    entry.SortOrder || 0, entry.Icon, entry.IsExpanded ? 1 : 0,
                    entry.Mood ?? null, entry.IsFavorited ? 1 : 0, entry.Tags ?? '[]',
                    entry.IsDeleted ? 1 : 0, entry.DeletedDate ?? null,
                    entry.IsPinned ? 1 : 0, entry.PinnedDate ?? null,
                    entry.LastAccessedDate ?? null
                );
                entryIdMap.set(entry.EntryID, r.lastInsertRowid as number);
            }

            // F. Attachments (image/file blobs).
            const attIdMap = new Map<number, number>();
            const importedAtts = await db.prepare("SELECT * FROM imported.Attachment").all() as ImportedAttachmentRow[];
            console.log(`[Import] Copying ${importedAtts.length} attachment(s)...`);
            for (const att of importedAtts) {
                const r = await db.prepare(`
                    INSERT INTO main.Attachment (UserID, Filename, MimeType, Size, Data)
                    VALUES (?, ?, ?, ?, ?)
                `).run(userId, att.Filename, att.MimeType, att.Size, att.Data);
                attIdMap.set(att.AttachmentID, r.lastInsertRowid as number);
            }

            // G. EntryContent — rewriting /api/attachment/{oldId} → {newId}.
            const importedContent = await db.prepare("SELECT * FROM imported.EntryContent").all() as ImportedContentRow[];
            for (const content of importedContent) {
                const newEntryId = entryIdMap.get(content.EntryID);
                if (!newEntryId) continue;

                let html: string = content.HtmlContent ?? '';
                let docJson: string | null = content.DocumentJson ?? null;
                // Single-pass remap. A naive per-id replaceAll loop collides on
                // shared prefixes ("/api/attachment/1" is a substring of
                // "/api/attachment/15"), silently corrupting longer ids. Match
                // the full numeric id once and substitute its mapped value.
                html = remapEntryRefs(remapAttachmentRefs(html, attIdMap), entryIdMap);
                if (docJson) docJson = remapEntryRefs(remapAttachmentRefs(docJson, attIdMap), entryIdMap);

                await db.prepare(`
                    INSERT INTO main.EntryContent(EntryID, HtmlContent, DocumentJson)
                    VALUES(?, ?, ?)
                `).run(newEntryId, html, docJson);
            }

            // G2. Templates were inserted in step B (before attIdMap existed), but
            // a template "Save as…" captures an entry's live HTML which can embed
            // /api/attachment/{id} refs. Remap those to the new attachment ids now
            // so a template made from an entry-with-image isn't left pointing at a
            // stale (deleted) id after restore.
            const hasRemappableRef = (s: string | null | undefined) =>
                !!s && (s.includes('/api/attachment/') || s.includes('journal://entry/') || s.includes('data-entry-id='));
            const remapRefs = (s: string) => remapEntryRefs(remapAttachmentRefs(s, attIdMap), entryIdMap);
            for (const t of importedTemplates) {
                const newTemplateId = templateIdMap.get(t.TemplateID);
                if (!newTemplateId) continue;
                if (!(hasRemappableRef(t.HtmlContent) || hasRemappableRef(t.DocumentJson))) continue;
                const newHtml = t.HtmlContent != null ? remapRefs(t.HtmlContent) : null;
                const newJson = t.DocumentJson != null ? remapRefs(t.DocumentJson) : null;
                await db.prepare(
                    'UPDATE main.Template SET HtmlContent = ?, DocumentJson = ? WHERE TemplateID = ?'
                ).run(newHtml, newJson, newTemplateId);
            }

            // H. Fix ParentEntryID hierarchy.
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

            // I. Entry↔Topic links (remap both ids).
            const importedEntryTopics = await safeAll<ImportedEntryTopicRow>("SELECT * FROM imported.EntryTopic");
            for (const et of importedEntryTopics) {
                const newEntryId = entryIdMap.get(et.EntryID);
                const newTopicId = topicIdMap.get(et.TopicID);
                if (newEntryId && newTopicId) {
                    await db.prepare('INSERT OR IGNORE INTO main.EntryTopic (EntryID, TopicID) VALUES (?, ?)')
                        .run(newEntryId, newTopicId);
                }
            }

            // J. Habits + logs (remap HabitID).
            const importedHabits = await safeAll<ImportedHabitRow>("SELECT * FROM imported.Habit");
            const habitIdMap = new Map<number, number>();
            for (const h of importedHabits) {
                const r = await db.prepare(`
                    INSERT INTO main.Habit (UserID, Name, Color, Goal, CreatedAt) VALUES (?, ?, ?, ?, ?)
                `).run(userId, h.Name, h.Color ?? '#10b981', h.Goal ?? 1, h.CreatedAt ?? null);
                habitIdMap.set(h.HabitID, r.lastInsertRowid as number);
            }
            const importedHabitLogs = await safeAll<ImportedHabitLogRow>("SELECT * FROM imported.HabitLog");
            for (const log of importedHabitLogs) {
                const newHabitId = habitIdMap.get(log.HabitID);
                if (newHabitId) {
                    await db.prepare('INSERT OR IGNORE INTO main.HabitLog (HabitID, Date, Count) VALUES (?, ?, ?)')
                        .run(newHabitId, log.Date, log.Count ?? 1);
                }
            }

            // K. Reminders / WordGoals / SavedSearches (remap entry/category FKs).
            const importedReminders = await safeAll<ImportedReminderRow>("SELECT * FROM imported.Reminder");
            const reminderIdMap = new Map<number, number>();
            for (const rem of importedReminders) {
                const newEntryId = rem.EntryID ? entryIdMap.get(rem.EntryID) ?? null : null;
                const r = await db.prepare(`
                    INSERT INTO main.Reminder(UserID, Title, Notes, DueAt, IsComplete, CompletedAt, EntryID, CreatedAt, RecurInterval, RecurEvery, ReminderType, Status, LeadMinutes, NotifiedAt)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    userId, rem.Title, rem.Notes ?? null, rem.DueAt,
                    rem.IsComplete ? 1 : 0, rem.CompletedAt ?? null, newEntryId, rem.CreatedAt ?? null,
                    rem.RecurInterval ?? null, rem.RecurEvery ?? null,
                    rem.ReminderType ?? 'Appointment', rem.Status ?? 'active',
                    rem.LeadMinutes ?? 0, rem.NotifiedAt ?? null
                );
                if (rem.ReminderID) reminderIdMap.set(rem.ReminderID, r.lastInsertRowid as number);
            }
            // Second pass: re-link recurrence chains (a completed recurring
            // reminder points at the occurrence its completion spawned, so
            // un-completing after a restore can still delete that occurrence).
            for (const rem of importedReminders) {
                if (!rem.ReminderID || !rem.NextOccurrenceID) continue;
                const newId = reminderIdMap.get(rem.ReminderID);
                const newNext = reminderIdMap.get(rem.NextOccurrenceID);
                if (newId && newNext) {
                    await db.prepare('UPDATE main.Reminder SET NextOccurrenceID = ? WHERE ReminderID = ?').run(newNext, newId);
                }
            }
            const importedGoals = await safeAll<ImportedGoalRow>("SELECT * FROM imported.WordGoal");
            for (const g of importedGoals) {
                const newCatId = g.CategoryID ? catIdMap.get(g.CategoryID) ?? null : null;
                await db.prepare(`
                    INSERT INTO main.WordGoal(UserID, Type, Target, StartDate, EndDate, CategoryID, CreatedAt)
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                `).run(userId, g.Type, g.Target, g.StartDate, g.EndDate ?? null, newCatId, g.CreatedAt ?? null);
            }
            const importedSearches = await safeAll<ImportedSavedSearchRow>("SELECT * FROM imported.SavedSearch");
            for (const s of importedSearches) {
                await db.prepare(`
                    INSERT INTO main.SavedSearch(UserID, Name, QueryJson, CreatedAt)
                    VALUES(?, ?, ?, ?)
                `).run(userId, s.Name, s.QueryJson, s.CreatedAt ?? null);
            }

            // L. Snippets / per-user settings / backup schedules (no FKs to remap).
            // Snippet content can embed /api/attachment/{id} refs (a snippet saved
            // from content with an image), so remap them to the new attachment ids.
            const importedSnippets = await safeAll<ImportedSnippetRow>("SELECT * FROM imported.Snippet");
            for (const s of importedSnippets) {
                const content = hasRemappableRef(s.Content)
                    ? remapRefs(s.Content)
                    : s.Content;
                await db.prepare(`
                    INSERT INTO main.Snippet (UserID, Name, Content, Shortcut, CreatedAt) VALUES (?, ?, ?, ?, ?)
                `).run(userId, s.Name, content, s.Shortcut ?? null, s.CreatedAt ?? null);
            }
            const importedSettings = await safeAll<ImportedUserSettingRow>("SELECT * FROM imported.UserSetting");
            for (const us of importedSettings) {
                await db.prepare(`
                    INSERT OR REPLACE INTO main.UserSetting (UserID, Key, Value) VALUES (?, ?, ?)
                `).run(userId, us.Key, us.Value ?? null);
            }
            const importedSchedules = await safeAll<ImportedBackupScheduleRow>("SELECT * FROM imported.BackupSchedule");
            for (const bs of importedSchedules) {
                await db.prepare(`
                    INSERT INTO main.BackupSchedule (UserID, IntervalDays, DestPath, LastRun, Enabled) VALUES (?, ?, ?, ?, ?)
                `).run(userId, bs.IntervalDays, bs.DestPath, bs.LastRun ?? null, bs.Enabled ?? 1);
            }

            console.log(`[Import] Done. ${importedCats.length} categories, ${importedEntries.length} entries, ${importedAtts.length} attachments, ${importedTemplates.length} templates, ${importedTopics.length} topics, ${importedHabits.length} habits.`);
        });

        await transaction();

        // 3. DETACH
        await db.prepare("DETACH imported").run();

        // 4. Cleanup (only if we wrote the temp file)
        if (ownsTempFile && tempPath) await unlink(tempPath);

        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        console.error("Import failed:", error);
        try { await db.prepare("DETACH imported").run(); } catch { }
        try { if (ownsTempFile && tempPath) await unlink(tempPath); } catch { }
        const body: { error: string; details?: string } = { error: "Failed to import" };
        if (process.env.NODE_ENV !== 'production') {
            body.details = error instanceof Error ? error.message : String(error);
        }
        return NextResponse.json(body, { status: 500 });
    } finally {
        releaseImportLock();
    }
}
