import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CreateEntrySchema = z.object({
    categoryId: z.number().or(z.string().transform(val => parseInt(val, 10))),
    userId: z.number().or(z.string().transform(val => parseInt(val, 10))),
    title: z.string().optional().default('Untitled Page'),
    parentEntryId: z.number().optional().nullable(),
    entryType: z.enum(['Page', 'Folder']).optional().default('Page'),
    templateId: z.number().optional().nullable(),
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { categoryId, userId, title, parentEntryId, entryType, templateId } = CreateEntrySchema.parse(body);

        // Security check: Ensure category belongs to user
        const category = await db.prepare('SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);

        if (!category) {
            return NextResponse.json({ error: "Category not found or unauthorized" }, { status: 403 });
        }

        // Optionally load template content
        let initialDelta = JSON.stringify({ ops: [{ insert: "\n" }] });
        let initialHtml = '';
        let initialPreview = 'Start writing...';

        if (templateId) {
            const tmpl = await db.prepare(
                'SELECT QuillDelta, HtmlContent FROM Template WHERE TemplateID = ? AND UserID = ?'
            ).get(templateId, userId) as { QuillDelta: string | null; HtmlContent: string } | undefined;

            if (tmpl) {
                if (tmpl.QuillDelta) initialDelta = tmpl.QuillDelta;
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
                INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent)
                VALUES (?, ?, ?)
            `).run(newEntryId, initialDelta, initialHtml);

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
