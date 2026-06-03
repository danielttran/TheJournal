import { db, dbManager } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveInitialEntryContent } from "@/lib/categoryTemplate";
import { maybeEncryptForCategory } from "@/lib/entryEncryption";

const CreateEntrySchema = z.object({
    categoryId: z.number().or(z.string().transform(val => parseInt(val, 10))),
    title: z.string().optional().default('Untitled Page'),
    parentEntryId: z.number().optional().nullable(),
    entryType: z.enum(['Page', 'Folder']).optional().default('Page'),
    templateId: z.number().optional().nullable(),
});

export async function POST(req: NextRequest) {
    try {
        // Auth: always read userId from session cookie — never trust the request body.
        const userId = getUserIdFromRequest(req);
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { categoryId, title, parentEntryId, entryType, templateId } = CreateEntrySchema.parse(body);

        // Security check: Ensure category belongs to user
        const category = await db.prepare(
            'SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?'
        ).get(categoryId, userId);

        if (!category) {
            return NextResponse.json({ error: "Category not found or unauthorized" }, { status: 403 });
        }

        // If nesting under a parent, the parent must belong to this user and
        // live in the same category. Without this a client could attach a child
        // to a foreign/other-category parent id, producing a structurally
        // invalid tree that the recursive subtree CTEs (trash/bulk/move) walk.
        if (parentEntryId) {
            const parent = await db.prepare(`
                SELECT 1 FROM Entry e
                JOIN Category c ON e.CategoryID = c.CategoryID
                WHERE e.EntryID = ? AND c.UserID = ? AND e.CategoryID = ?
            `).get(parentEntryId, userId, categoryId);
            if (!parent) {
                return NextResponse.json({ error: "Parent entry not found or not in this category" }, { status: 400 });
            }
        }

        const { html: initialHtml, documentJson: initialDocumentJson, previewText: initialPreview }
            = await resolveInitialEntryContent(
                dbManager,
                userId,
                Number(categoryId),
                { explicitTemplateId: templateId ?? null },
            );

        // Encrypt initial content if the category is password-locked. Refuse
        // when the EEK isn't cached — silently writing plaintext to a locked
        // category would defeat the lock.
        let storedHtml: string;
        let storedJson: string;
        try {
            const enc = await maybeEncryptForCategory(
                dbManager, userId, Number(categoryId), initialHtml, initialDocumentJson,
            );
            storedHtml = enc.html ?? '';
            storedJson = enc.documentJson ?? initialDocumentJson;
        } catch (err) {
            if ((err as Error & { code?: string }).code === 'CATEGORY_LOCKED') {
                return NextResponse.json(
                    { error: 'Category is locked. Unlock it before creating new entries.' },
                    { status: 423 },
                );
            }
            throw err;
        }

        // Create Entry + Content atomically to prevent orphaned rows
        const createEntry = db.transaction(async () => {
            // Store CreatedDate in LOCAL naive time (matching the by-date journal
            // path's "YYYY-MM-DD HH:MM:SS" convention) rather than the UTC
            // CURRENT_TIMESTAMP default. The whole app buckets CreatedDate as
            // naive-local (stats/heatmap/anniversary/search), so a UTC stamp here
            // mis-files notebook entries by a day in non-UTC timezones.
            const result = await db.prepare(`
                INSERT INTO Entry (CategoryID, Title, PreviewText, ParentEntryID, EntryType, CreatedDate, ModifiedDate)
                VALUES (?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
            `).run(categoryId, title, initialPreview, parentEntryId || null, entryType);

            const newEntryId = result.lastInsertRowid;

            await db.prepare(`
                INSERT INTO EntryContent (EntryID, HtmlContent, DocumentJson)
                VALUES (?, ?, ?)
            `).run(newEntryId, storedHtml, storedJson);

            return newEntryId;
        });

        const newEntryId = await createEntry();

        return NextResponse.json({
            id: newEntryId,
            EntryID: newEntryId,
            Title: title,
            ParentEntryID: parentEntryId,
            EntryType: entryType
        });

    } catch (error) {
        console.error("Error creating entry:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
