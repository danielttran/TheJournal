import { dbManager } from "@/lib/db";
import { renderEntryForPrint } from "@/lib/printRender";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

interface EntryRow {
    EntryID: number;
    Title: string;
    CreatedDate: string;
    ModifiedDate: string;
    Mood: string | null;
    Tags: string | null;
    HtmlContent: string | null;
    CategoryName: string;
    UserID: number;
}

/**
 * GET /api/entry/:id/print — David RM "Print" / "Export to PDF" parity.
 * Returns a self-contained HTML document the renderer (browser print or
 * Electron webContents.printToPDF) can use directly. Authorisation is the
 * usual user-owns-the-category check.
 */
export const GET = authedHandler<[NextRequest, { params: Promise<{ id: string }> }]>(
    'GET /api/entry/[id]/print',
    async (userId, _req, { params }) => {
        const { id } = await params;
        const entryId = parseInt(id, 10);
        if (!Number.isFinite(entryId)) {
            return NextResponse.json({ error: 'Invalid entry id' }, { status: 400 });
        }

        const row = await dbManager.prepare(`
            SELECT e.EntryID, e.Title, e.CreatedDate, e.ModifiedDate, e.Mood, e.Tags,
                   ec.HtmlContent, c.Name AS CategoryName, c.UserID
            FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
            WHERE e.EntryID = ? AND e.IsDeleted = 0
        `).get(entryId) as EntryRow | undefined;

        if (!row || row.UserID !== userId) {
            return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
        }

        let tags: string[] = [];
        if (row.Tags) {
            try {
                const parsed = JSON.parse(row.Tags);
                if (Array.isArray(parsed)) tags = parsed.filter(t => typeof t === 'string');
            } catch { /* tolerate corrupt tag payload */ }
        }

        const html = renderEntryForPrint({
            title: row.Title,
            htmlContent: row.HtmlContent ?? '',
            createdDate: row.CreatedDate,
            modifiedDate: row.ModifiedDate,
            categoryName: row.CategoryName,
            mood: row.Mood,
            tags,
        });

        return new NextResponse(html, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
        });
    },
);
