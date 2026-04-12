import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const RequestSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
    categoryId: z.number().or(z.string().transform(val => parseInt(val, 10))),
});

export async function POST(req: NextRequest) {
    try {
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get('userId');
        if (!userIdCookie?.value) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const userId = parseInt(userIdCookie.value, 10);
        if (isNaN(userId)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { date, categoryId } = RequestSchema.parse(body);

        // Security check: Ensure category belongs to user
        const category = await db.prepare('SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);

        if (!category) {
            return NextResponse.json({ error: "Category not found or unauthorized" }, { status: 403 });
        }

        // Check and create atomically inside a transaction to prevent duplicate entries
        // from concurrent requests for the same date (TOCTOU race condition).
        const initialDelta = JSON.stringify({ ops: [{ insert: "\n" }] });
        const initialDocumentJson = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
        const getOrCreateEntry = db.transaction(async () => {
            // Re-check inside the transaction so the SELECT + INSERT are atomic
            const existing = await db.prepare(`
                SELECT e.EntryID, e.Title, ec.QuillDelta, ec.HtmlContent, ec.DocumentJson, e.Version
                FROM Entry e
                LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
                WHERE e.CategoryID = ? AND date(e.CreatedDate) = ?
            `).get(categoryId, date) as any;

            if (existing) return { entry: existing, isNew: false };

            // We explicitly set CreatedDate to the requested date (at 12:00 PM to avoid timezone edge cases if just date)
            const newEntryResult = await db.prepare(`
                INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate)
                VALUES (?, ?, ?, ?)
            `).run(categoryId, 'New Entry', 'Start writing...', `${date} 12:00:00`);

            const newEntryId = newEntryResult.lastInsertRowid;

            await db.prepare(`
                INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent, DocumentJson)
                VALUES (?, ?, ?, ?)
            `).run(newEntryId, initialDelta, '', initialDocumentJson);

            return { entry: { EntryID: newEntryId, Title: 'New Entry', QuillDelta: initialDelta, HtmlContent: '', DocumentJson: initialDocumentJson, Version: 1 }, isNew: true };
        });

        const { entry, isNew } = await getOrCreateEntry();

        return NextResponse.json({
            id: entry.EntryID,
            title: entry.Title,
            content: entry.QuillDelta ? JSON.parse(entry.QuillDelta) : null,
            html: entry.HtmlContent,
            documentJson: entry.DocumentJson ?? null,
            Version: entry.Version ?? 1,
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
