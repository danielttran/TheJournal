import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateSchema = z.object({
    content: z.any().optional(), // JSON object (Quill Delta) - OPTIONAL for metadata-only updates
    html: z.string().optional(),
    title: z.string().optional(),
    preview: z.string().optional(),
    userId: z.number().or(z.string().transform(val => parseInt(val, 10))),
    icon: z.string().optional(),
    sortOrder: z.number().optional(),
    parentEntryId: z.number().nullable().optional(),
    isLocked: z.boolean().optional(),
    entryType: z.enum(['Page', 'Section']).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const entryId = parseInt(id, 10);

        const entry = db.prepare(`
            SELECT e.EntryID, e.Title, ec.HtmlContent, ec.QuillDelta, e.Icon
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
        console.log("PUT Body:", body, "EntryID:", entryId);

        // 1. Validation
        const result = UpdateSchema.safeParse(body);
        if (!result.success) {
            console.error("Validation Error:", result.error);
            return NextResponse.json({ error: result.error.errors }, { status: 400 });
        }

        const { content, html, title, preview, userId, icon, sortOrder, parentEntryId, isLocked, entryType } = result.data;
        console.log("Parsed Data:", { icon, title, sortOrder, content: content ? 'Present' : 'None' });

        // 2. Security Check
        const entry = db.prepare(`
            SELECT 1 FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId);

        if (!entry) {
            return NextResponse.json({ error: "Entry not found or unauthorized" }, { status: 403 });
        }

        // 3. Update Content (if provided)
        if (content !== undefined) {
            const deltaString = JSON.stringify(content);
            const updateContent = db.prepare(`
                UPDATE EntryContent 
                SET QuillDelta = ?, HtmlContent = ? 
                WHERE EntryID = ?
            `).run(deltaString, html || '', entryId);

            if (updateContent.changes === 0) {
                db.prepare(`
                    INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent) 
                    VALUES (?, ?, ?)
                `).run(entryId, deltaString, html || '');
            }
        }

        // 4. Update Metadata
        const updates: string[] = [];
        const values: any[] = [];

        if (title !== undefined) { updates.push("Title = ?"); values.push(title); }
        if (preview !== undefined) { updates.push("PreviewText = ?"); values.push(preview); }
        if (icon !== undefined) { updates.push("Icon = ?"); values.push(icon); }
        if (sortOrder !== undefined) { updates.push("SortOrder = ?"); values.push(sortOrder); }
        if (parentEntryId !== undefined) { updates.push("ParentEntryID = ?"); values.push(parentEntryId); }
        if (isLocked !== undefined) { updates.push("IsLocked = ?"); values.push(isLocked ? 1 : 0); }
        if (entryType !== undefined) { updates.push("EntryType = ?"); values.push(entryType); }

        console.log("Updates array:", updates, "Values:", values);

        if (updates.length > 0) {
            values.push(entryId);
            const runResult = db.prepare(`UPDATE Entry SET ${updates.join(", ")} WHERE EntryID = ?`).run(...values);
            console.log("Update Run Result:", runResult);
        } else if (content !== undefined) {
            // If ONLY content changed, touch Entry timestamp
            db.prepare(`UPDATE Entry SET ModifiedDate = CURRENT_TIMESTAMP WHERE EntryID = ?`).run(entryId);
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Error updating entry:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
