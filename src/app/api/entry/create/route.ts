import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CreateEntrySchema = z.object({
    categoryId: z.number().or(z.string().transform(val => parseInt(val, 10))),
    userId: z.number().or(z.string().transform(val => parseInt(val, 10))),
    title: z.string().optional().default('Untitled Page'),
    parentEntryId: z.number().optional().nullable(),
    entryType: z.enum(['Page', 'Section']).optional().default('Page'),
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { categoryId, userId, title, parentEntryId, entryType } = CreateEntrySchema.parse(body);

        // Security check: Ensure category belongs to user
        const category = await db.prepare('SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);

        if (!category) {
            return NextResponse.json({ error: "Category not found or unauthorized" }, { status: 403 });
        }

        // Create Entry + Content atomically to prevent orphaned rows
        const initialDelta = JSON.stringify({ ops: [{ insert: "\n" }] });
        const createEntry = db.transaction(async () => {
            const result = await db.prepare(`
                INSERT INTO Entry (CategoryID, Title, PreviewText, ParentEntryID, EntryType)
                VALUES (?, ?, ?, ?, ?)
            `).run(categoryId, title, 'Start writing...', parentEntryId || null, entryType);

            const newEntryId = result.lastInsertRowid;

            await db.prepare(`
                INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent)
                VALUES (?, ?, ?)
            `).run(newEntryId, initialDelta, '');

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
