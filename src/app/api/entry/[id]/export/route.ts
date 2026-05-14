import { db } from "@/lib/db";
import { exportEntry } from "@/lib/markdown";
import { exportEntryAsHTML, htmlToPlainText, exportEntriesAsATOM } from "@/lib/export-formats";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const GET = authedHandler<[NextRequest, Params]>('GET /api/entry/[id]/export', async (userId, req, { params }) => {
    const { id } = await params;
    const entryId = parseInt(id, 10);
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get('format') ?? 'md').toLowerCase();

    const row = await db.prepare(`
        SELECT e.EntryID, e.Title, e.CreatedDate, e.ModifiedDate, e.Tags, e.Mood, ec.HtmlContent
        FROM Entry e
        JOIN Category cat ON e.CategoryID = cat.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE e.EntryID = ? AND cat.UserID = ? AND e.IsDeleted = 0
    `).get(entryId, userId) as {
        EntryID: number; Title: string; CreatedDate: string; ModifiedDate: string;
        Tags: string; Mood: string | null; HtmlContent: string | null;
    } | undefined;

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let tags: string[] = [];
    try { tags = row.Tags ? JSON.parse(row.Tags) : []; } catch {}

    const fm = {
        title: row.Title || 'Untitled',
        createdDate: row.CreatedDate,
        modifiedDate: row.ModifiedDate,
        tags,
        mood: row.Mood ?? null,
    };
    const html = row.HtmlContent ?? '';
    const safeTitle = (row.Title || 'entry').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);

    if (format === 'html') {
        const body = exportEntryAsHTML(fm, html);
        return new NextResponse(body, {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Disposition': `attachment; filename="${safeTitle}.html"`,
            },
        });
    }
    if (format === 'txt') {
        const body = `${fm.title}\n${'='.repeat(fm.title.length)}\n${fm.createdDate}\n\n${htmlToPlainText(html)}`;
        return new NextResponse(body, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Disposition': `attachment; filename="${safeTitle}.txt"`,
            },
        });
    }
    if (format === 'atom') {
        const body = exportEntriesAsATOM(
            [{ id: row.EntryID, title: fm.title, html, createdDate: fm.createdDate, modifiedDate: fm.modifiedDate }],
            fm.title
        );
        return new NextResponse(body, {
            headers: {
                'Content-Type': 'application/atom+xml; charset=utf-8',
                'Content-Disposition': `attachment; filename="${safeTitle}.atom"`,
            },
        });
    }

    // Default: markdown
    const md = exportEntry(fm, html);
    return new NextResponse(md, {
        headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${safeTitle}.md"`,
        },
    });
});
