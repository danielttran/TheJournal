import { dbManager } from "@/lib/db";
import { computeWordCloud } from "@/lib/wordcloud";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export const GET = authedHandler<[NextRequest]>('GET /api/wordcloud', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const categoryIdParam = searchParams.get('categoryId');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);
    const minLength = Math.max(2, Math.min(parseInt(searchParams.get('minLength') ?? '3', 10) || 3, 12));

    const params: (string | number)[] = [userId];
    let extra = '';
    if (categoryIdParam) {
        const cid = parseInt(categoryIdParam, 10);
        if (!isNaN(cid)) {
            extra = ' AND e.CategoryID = ?';
            params.push(cid);
        }
    }

    // Cap entries scanned so a huge DB doesn't OOM the server. Most-recent first.
    const MAX_ENTRIES = 5000;
    const rows = await dbManager.prepare(`
        SELECT ec.HtmlContent FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE c.UserID = ? AND e.IsDeleted = 0${extra}
        ORDER BY e.ModifiedDate DESC
        LIMIT ?
    `).all(...params, MAX_ENTRIES) as { HtmlContent: string | null }[];

    const cloud = computeWordCloud(
        rows.map(r => r.HtmlContent ?? ''),
        { limit, minLength }
    );
    return NextResponse.json({ words: cloud, scannedEntries: rows.length, capped: rows.length === MAX_ENTRIES });
});
