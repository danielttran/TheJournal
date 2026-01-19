import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateSchema = z.object({
    content: z.any(), // JSON object (Quill Delta)
    html: z.string().optional(),
    title: z.string().optional(),
    preview: z.string().optional(),
    userId: z.number().or(z.string().transform(val => parseInt(val, 10))),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const entryId = parseInt(id, 10);

        const entry = db.prepare(`
            SELECT e.EntryID, e.Title, ec.HtmlContent, ec.QuillDelta 
            FROM Entry e
            LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
            WHERE e.EntryID = ?
        `).get(entryId);

        if (!entry) {
            return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        }

        return NextResponse.json(entry);
    } catch (error) {
        console.error("Error fetching entry:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const entryId = parseInt(id, 10);
        const body = await req.json();

        const { content, html, title, preview, userId } = UpdateSchema.parse(body);

        // Security check: Ensure entry belongs to user via Category
        const entry = db.prepare(`
            SELECT 1 FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId);

        if (!entry) {
            return NextResponse.json({ error: "Entry not found or unauthorized" }, { status: 403 });
        }

        // Update Content
        const deltaString = JSON.stringify(content);

        const updateContent = db.prepare(`
            UPDATE EntryContent 
            SET QuillDelta = ?, HtmlContent = ? 
            WHERE EntryID = ?
        `).run(deltaString, html || '', entryId);

        // If row doesn't exist in EntryContent (unexpected but possible if manually deleted), insert it
        if (updateContent.changes === 0) {
            db.prepare(`
                INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent) 
                VALUES (?, ?, ?)
            `).run(entryId, deltaString, html || '');
        }

        // Update Metadata if provided
        if (title || preview) {
            const updates = [];
            const values = [];

            if (title !== undefined) {
                updates.push("Title = ?");
                values.push(title);
            }
            if (preview !== undefined) {
                updates.push("PreviewText = ?");
                values.push(preview);
            }

            // Explicitly verify triggered update of ModifiedDate, 
            // but the Trigger in schema should handle it. 
            // We can just trust the schema trigger.

            values.push(entryId);

            db.prepare(`UPDATE Entry SET ${updates.join(", ")} WHERE EntryID = ?`).run(...values);
        } else {
            // Even if only content changed, we might want to touch the Entry ModifiedDate
            // The Schema Trigger (UpdateEntryTimestamp) is "AFTER UPDATE ON Entry". 
            // Updating EntryContent does NOT trigger it automatically unless we propagate it.
            // Let's manually touch Entry.
            db.prepare(`UPDATE Entry SET ModifiedDate = CURRENT_TIMESTAMP WHERE EntryID = ?`).run(entryId);
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Error updating entry:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
