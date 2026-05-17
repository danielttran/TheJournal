import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie?.value) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const userId = parseInt(userIdCookie.value, 10);
        if (isNaN(userId)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { categoryId, title, parentEntryId, entryType, templateId } = CreateEntrySchema.parse(body);

        // Security check: Ensure category belongs to user
        const category = await db.prepare(
            'SELECT AutoTemplateID FROM Category WHERE CategoryID = ? AND UserID = ?'
        ).get(categoryId, userId) as { AutoTemplateID: number | null } | undefined;

        if (!category) {
            return NextResponse.json({ error: "Category not found or unauthorized" }, { status: 403 });
        }

        // DavidRM parity: auto-insert the category's default template when the
        // caller didn't pick one explicitly.
        const effectiveTemplateId = templateId
            || (category.AutoTemplateID && category.AutoTemplateID > 0 ? category.AutoTemplateID : null);

        // Optionally load template content
        let initialDocumentJson = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
        let initialHtml = '';
        let initialPreview = 'Start writing...';

        if (effectiveTemplateId) {
            const tmpl = await db.prepare(
                'SELECT HtmlContent, DocumentJson FROM Template WHERE TemplateID = ? AND UserID = ?'
            ).get(effectiveTemplateId, userId) as { HtmlContent: string; DocumentJson: string | null } | undefined;

            if (tmpl) {
                if (tmpl.DocumentJson) initialDocumentJson = tmpl.DocumentJson;
                initialHtml = tmpl.HtmlContent || '';
                // Derive preview from HTML
                const plain = initialHtml.replace(/<[^>]+>/g, ' ').trim();
                initialPreview = plain.substring(0, 200) || 'Start writing...';
            }
        }

        // Create Entry + Content atomically to prevent orphaned rows
        const createEntry = db.transaction(async () => {
            const result = await db.prepare(`
                INSERT INTO Entry (CategoryID, Title, PreviewText, ParentEntryID, EntryType)
                VALUES (?, ?, ?, ?, ?)
            `).run(categoryId, title, initialPreview, parentEntryId || null, entryType);

            const newEntryId = result.lastInsertRowid;

            await db.prepare(`
                INSERT INTO EntryContent (EntryID, HtmlContent, DocumentJson)
                VALUES (?, ?, ?)
            `).run(newEntryId, initialHtml, initialDocumentJson);

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
