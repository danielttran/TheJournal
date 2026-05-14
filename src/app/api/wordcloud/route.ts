import { dbManager } from "@/lib/db";
import { computeWordCloud } from "@/lib/wordcloud";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export const GET = authedHandler<[NextRequest]>('GET /api/wordcloud', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const categoryIdParam = searchParams.get('categoryId');
    const limitParam = parseInt(searchParams.get('limit') ?? '50', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
    const minLengthParam = parseInt(searchParams.get('minLength') ?? '3', 10);
    const minLength = Math.max(2, Number.isFinite(minLengthParam) && minLengthParam > 0 ? minLengthParam : 3);

    const params: (string | number)[] = [userId];
    let extra = '';
    if (categoryIdParam) {
        const cid = parseInt(categoryIdParam, 10);
        if (!isNaN(cid)) {
            extra = ' AND e.CategoryID = ?';
            params.push(cid);
        }
    }

    const rows = await dbManager.prepare(`
        SELECT ec.HtmlContent FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE c.UserID = ? AND e.IsDeleted = 0${extra}
        ORDER BY e.ModifiedDate DESC
    `).all(...params) as { HtmlContent: string | null }[];

    const cloud = computeWordCloud(
        rows.map(r => r.HtmlContent ?? ''),
        { limit, minLength }
    );
    return NextResponse.json({ words: cloud, scannedEntries: rows.length, capped: false });
});
