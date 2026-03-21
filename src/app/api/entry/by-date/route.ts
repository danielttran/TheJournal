import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const RequestSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
    categoryId: z.number().or(z.string().transform(val => parseInt(val, 10))),
    userId: z.number().or(z.string().transform(val => parseInt(val, 10))),
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { date, categoryId, userId } = RequestSchema.parse(body);

        // Security check: Ensure category belongs to user
        const category = db.prepare('SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);

        if (!category) {
            return NextResponse.json({ error: "Category not found or unauthorized" }, { status: 403 });
        }

        // Check if entry exists for this date (using SQLite date function)
        // We assume CreatedDate stores the "Journal Date". 
        // For a more robust app, we might want a separate 'EntryDate' column, 
        // but 'CreatedDate' works if we override it on creation.
        const entry = db.prepare(`
            SELECT e.EntryID, e.Title, ec.QuillDelta, ec.HtmlContent, e.Version
            FROM Entry e
            LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
            WHERE e.CategoryID = ? AND date(e.CreatedDate) = ?
        `).get(categoryId, date) as any;

        if (entry) {
            return NextResponse.json({
                id: entry.EntryID,
                title: entry.Title,
                content: entry.QuillDelta ? JSON.parse(entry.QuillDelta) : null,
                html: entry.HtmlContent,
                Version: entry.Version ?? 1,
                isNew: false
            });
        }

        // Create new Entry
        // We explicitly set CreatedDate to the requested date (at 12:00 PM to avoid timezone edge cases if just date)
        const newEntryResult = db.prepare(`
            INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate) 
            VALUES (?, ?, ?, ?)
        `).run(categoryId, 'New Entry', 'Start writing...', `${date} 12:00:00`);

        const newEntryId = newEntryResult.lastInsertRowid;

        // Create empty Content
        const initialDelta = JSON.stringify({ ops: [{ insert: "\n" }] });
        db.prepare(`
            INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent) 
            VALUES (?, ?, ?)
        `).run(newEntryId, initialDelta, '');

        return NextResponse.json({
            id: newEntryId,
            title: 'New Entry',
            content: { ops: [{ insert: "\n" }] },
            html: '',
            isNew: true
        });

    } catch (error) {
        console.error("Error in /api/entry/by-date:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
