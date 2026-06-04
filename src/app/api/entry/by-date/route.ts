import { db, dbManager } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveInitialEntryContent } from "@/lib/categoryTemplate";
import { linkEntryAsFutureReminder } from "@/lib/futureEntries";
import { maybeEncryptForCategory, decryptEntryContent } from "@/lib/entryEncryption";

const RequestSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
    categoryId: z.number().or(z.string().transform(val => parseInt(val, 10))),
});

export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromRequest(req);
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { date, categoryId } = RequestSchema.parse(body);

        // Security check: Ensure category belongs to user
        const category = await db.prepare('SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);

        if (!category) {
            return NextResponse.json({ error: "Category not found or unauthorized" }, { status: 403 });
        }

        // Resolve auto-template OUTSIDE the transaction so the SQLCipher
        // statement doesn't compete with the transaction for the same conn
        // and we keep the transaction body tight.
        const initial = await resolveInitialEntryContent(dbManager, userId, Number(categoryId));

        // If the category is password-locked, the initial content needs to be
        // encrypted with the cached EEK before insert. maybeEncryptForCategory
        // throws CATEGORY_LOCKED when the key isn't available — surface that
        // as 423 so the renderer can prompt for the password rather than
        // silently writing plaintext into a locked category.
        let encryptedInitial: { html: string; documentJson: string };
        try {
            const enc = await maybeEncryptForCategory(
                dbManager, userId, Number(categoryId), initial.html, initial.documentJson,
            );
            encryptedInitial = {
                html: enc.html ?? '',
                documentJson: enc.documentJson ?? initial.documentJson,
            };
        } catch (err) {
            if ((err as Error & { code?: string }).code === 'CATEGORY_LOCKED') {
                return NextResponse.json(
                    { error: 'Category is locked. Unlock it before creating new entries.' },
                    { status: 423 },
                );
            }
            throw err;
        }

        // Check and create atomically inside a transaction to prevent duplicate entries
        // from concurrent requests for the same date (TOCTOU race condition).
        const getOrCreateEntry = db.transaction(async () => {
            // Re-check inside the transaction so the SELECT + INSERT are atomic
            const existing = await db.prepare(`
                SELECT e.EntryID, e.Title, ec.HtmlContent, ec.DocumentJson, e.Version,
                       e.IsFavorited, e.Mood, e.Tags, e.IsLocked
                FROM Entry e
                LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
                WHERE e.CategoryID = ? AND date(e.CreatedDate) = ? AND e.IsDeleted = 0
            `).get(categoryId, date) as {
                EntryID: number; Title: string; Version: number;
                HtmlContent: string | null; DocumentJson: string | null;
                IsFavorited: number | boolean; Mood: string | null; Tags: string | null;
                IsLocked: number | boolean;
            } | undefined;

            if (existing) return { entry: existing, isNew: false };

            // We explicitly set CreatedDate to the requested date (at 12:00 PM to avoid timezone edge cases if just date)
            const newEntryResult = await db.prepare(`
                INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate)
                VALUES (?, ?, ?, ?)
            `).run(categoryId, 'New Entry', initial.previewText, `${date} 12:00:00`);

            const newEntryId = newEntryResult.lastInsertRowid;

            await db.prepare(`
                INSERT INTO EntryContent (EntryID, HtmlContent, DocumentJson)
                VALUES (?, ?, ?)
            `).run(newEntryId, encryptedInitial.html, encryptedInitial.documentJson);

            // Return the PLAINTEXT initial values to the renderer — the response
            // is for immediate editor population, not for re-encryption.
            return { entry: { EntryID: newEntryId, Title: 'New Entry', HtmlContent: initial.html, DocumentJson: initial.documentJson, Version: 1, IsFavorited: 0, Mood: null, Tags: '[]', IsLocked: 0 }, isNew: true };
        });

        const { entry, isNew } = await getOrCreateEntry();

        // Decrypt before returning. For an EXISTING entry in a password-locked
        // category the stored content is ENC1: ciphertext — returning it raw both
        // leaked it to the editor and got it double-encrypted on the next
        // autosave (corruption). decryptEntryContent returns plaintext when the
        // EEK is cached, or null content + locked=true when it isn't (the editor
        // then can't render or save ciphertext; a save would 423 anyway). New
        // entries return plaintext initial content, which passes through
        // unchanged (not ENC1:-prefixed). Mirrors GET /api/entry/[id].
        const decrypted = await decryptEntryContent(
            dbManager, userId, Number(categoryId), entry.HtmlContent, entry.DocumentJson,
        );

        // DavidRM parity: when the user navigates to a future date and a new
        // entry is created, surface it as an Event reminder. linkEntryAsFutureReminder
        // is a no-op for past/now dates so back-fills don't spawn stale reminders.
        if (isNew) {
            const nowIso = new Date().toISOString();
            const dueAt = new Date(`${date}T12:00:00`).toISOString();
            await linkEntryAsFutureReminder(dbManager, userId, {
                entryId: Number(entry.EntryID),
                title: entry.Title || `Journal entry — ${date}`,
                dueAt,
                nowIso,
            }).catch(err => {
                // Reminder creation failure shouldn't abort the entry — it's a
                // side-feature, not a write to the entry itself.
                console.error('[by-date] linkEntryAsFutureReminder failed:', err);
            });
        }

        return NextResponse.json({
            id: entry.EntryID,
            title: entry.Title,
            html: decrypted.html,
            documentJson: decrypted.documentJson ?? null,
            categoryLocked: decrypted.locked,
            Version: entry.Version ?? 1,
            IsFavorited: entry.IsFavorited ?? 0,
            Mood: entry.Mood ?? null,
            Tags: entry.Tags ?? '[]',
            IsLocked: entry.IsLocked ?? 0,
            isNew
        });

    } catch (error) {
        console.error("Error in /api/entry/by-date:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
