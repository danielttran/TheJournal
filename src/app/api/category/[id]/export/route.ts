import { db } from "@/lib/db";
import { exportCategory, type FrontmatterInput } from "@/lib/markdown";
import { exportEntriesAsATOM, htmlToPlainText, exportEntryAsHTML } from "@/lib/export-formats";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const GET = authedHandler<[NextRequest, Params]>('GET /api/category/[id]/export', async (userId, req, { params }) => {
    const { id } = await params;
    const categoryId = parseInt(id, 10);
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get('format') ?? 'md').toLowerCase();

    const cat = await db.prepare(
        'SELECT Name FROM Category WHERE CategoryID = ? AND UserID = ?'
    ).get(categoryId, userId) as { Name: string } | undefined;
    if (!cat) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const rows = await db.prepare(`
        SELECT e.EntryID, e.Title, e.CreatedDate, e.ModifiedDate, e.Tags, e.Mood, ec.HtmlContent
        FROM Entry e
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE e.CategoryID = ? AND e.IsDeleted = 0 AND e.EntryType = 'Page'
        ORDER BY e.CreatedDate ASC
    `).all(categoryId) as {
        EntryID: number; Title: string; CreatedDate: string; ModifiedDate: string;
        Tags: string; Mood: string | null; HtmlContent: string | null;
    }[];

    const safeName = cat.Name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);

    if (format === 'atom') {
        const atomEntries = rows.map(r => ({
            id: r.EntryID, title: r.Title || 'Untitled', html: r.HtmlContent ?? '',
            createdDate: r.CreatedDate, modifiedDate: r.ModifiedDate,
        }));
        const body = exportEntriesAsATOM(atomEntries, cat.Name);
        return new NextResponse(body, {
            headers: {
                'Content-Type': 'application/atom+xml; charset=utf-8',
                'Content-Disposition': `attachment; filename="${safeName}.atom"`,
            },
        });
    }

    if (format === 'txt') {
        const body = rows.map(r => {
            const title = r.Title || 'Untitled';
            return `${title}\n${'='.repeat(title.length)}\n${r.CreatedDate}\n\n${htmlToPlainText(r.HtmlContent)}`;
        }).join('\n\n---\n\n');
        return new NextResponse(body, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Disposition': `attachment; filename="${safeName}.txt"`,
            },
        });
    }

    if (format === 'html') {
        // One <article> per entry, all wrapped in a single HTML doc.
        const articles = rows.map(r => {
            let tags: string[] = [];
            try { tags = r.Tags ? JSON.parse(r.Tags) : []; } catch {}
            const fm = { title: r.Title || 'Untitled', createdDate: r.CreatedDate, modifiedDate: r.ModifiedDate, tags, mood: r.Mood ?? null };
            return exportEntryAsHTML(fm, r.HtmlContent ?? '');
        }).join('\n<hr/>\n');
        return new NextResponse(articles, {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Disposition': `attachment; filename="${safeName}.html"`,
            },
        });
    }

    // Default: markdown bundle
    const items = rows.map(r => {
        let tags: string[] = [];
        try { tags = r.Tags ? JSON.parse(r.Tags) : []; } catch {}
        const fm: FrontmatterInput = {
            title: r.Title || 'Untitled',
            createdDate: r.CreatedDate,
            modifiedDate: r.ModifiedDate,
            tags,
            mood: r.Mood ?? null,
        };
        return { entry: fm, html: r.HtmlContent ?? '' };
    });
    const md = exportCategory(items);
    return new NextResponse(md, {
        headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${safeName}.md"`,
        },
    });
});
