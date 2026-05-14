import { db } from "@/lib/db";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/entry/lookup?title=Foo
 * GET /api/entry/lookup?id=42
 * Returns { id, title } for the matching entry or 404.
 */
export const GET = authedHandler<[NextRequest]>('GET /api/entry/lookup', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const titleParam = searchParams.get('title');

    if (idParam) {
        const id = parseInt(idParam, 10);
        if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
        const row = await db.prepare(`
            SELECT e.EntryID, e.Title FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ? AND e.IsDeleted = 0
        `).get(id, userId) as { EntryID: number; Title: string } | undefined;
        if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json({ id: row.EntryID, title: row.Title });
    }

    if (titleParam) {
        const row = await db.prepare(`
            SELECT e.EntryID, e.Title FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE c.UserID = ? AND e.IsDeleted = 0 AND LOWER(e.Title) = LOWER(?)
            LIMIT 1
        `).get(userId, titleParam) as { EntryID: number; Title: string } | undefined;
        if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json({ id: row.EntryID, title: row.Title });
    }

    return NextResponse.json({ error: 'Missing id or title' }, { status: 400 });
});
