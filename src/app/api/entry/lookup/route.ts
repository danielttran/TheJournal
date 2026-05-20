import { db } from "@/lib/db";
import { authedHandler } from "@/lib/route-helpers";
import { parseEntryRef, globToSqlLike } from "@/lib/entryRefs";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const PATTERN_MAX_MATCHES = 50;

/**
 * GET /api/entry/lookup?title=Foo                       — exact title match.
 * GET /api/entry/lookup?id=42                           — by id.
 * GET /api/entry/lookup?ref=Daily%20Journal%5CTrip*     — DavidRM-style
 *     "category\title" reference with `*` / `?` wildcards. Returns a
 *     `matches` array (capped at PATTERN_MAX_MATCHES). Single result is
 *     also returned as `{ id, title }` for backwards compatibility with
 *     existing single-target callers.
 */
export const GET = authedHandler<[NextRequest]>('GET /api/entry/lookup', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const titleParam = searchParams.get('title');
    const refParam = searchParams.get('ref');

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

    if (refParam) {
        const ref = parseEntryRef(refParam);
        if (!ref) return NextResponse.json({ error: 'Invalid ref' }, { status: 400 });

        const where: string[] = ['c.UserID = ?', 'e.IsDeleted = 0'];
        const args: (string | number)[] = [userId];
        if (ref.categoryName) {
            where.push('LOWER(c.Name) = LOWER(?)');
            args.push(ref.categoryName);
        }
        // Exact match short-circuits the wildcard expansion so a non-glob
        // pattern uses the same path as ?title=...
        if (!/[*?]/.test(ref.titlePattern)) {
            where.push('LOWER(e.Title) = LOWER(?)');
            args.push(ref.titlePattern);
        } else {
            where.push("LOWER(e.Title) LIKE LOWER(?) ESCAPE '\\'");
            args.push(globToSqlLike(ref.titlePattern));
        }

        const rows = await db.prepare(`
            SELECT e.EntryID, e.Title, e.CategoryID, c.Name AS CategoryName
            FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE ${where.join(' AND ')}
            ORDER BY e.ModifiedDate DESC
            LIMIT ?
        `).all(...args, PATTERN_MAX_MATCHES) as
            { EntryID: number; Title: string; CategoryID: number; CategoryName: string }[];

        if (rows.length === 0) return NextResponse.json({ error: 'Not found', matches: [] }, { status: 404 });
        return NextResponse.json({
            id: rows[0].EntryID,
            title: rows[0].Title,
            matches: rows.map(r => ({
                id: r.EntryID, title: r.Title, categoryId: r.CategoryID, categoryName: r.CategoryName,
            })),
        });
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

    return NextResponse.json({ error: 'Missing id, title, or ref' }, { status: 400 });
});
