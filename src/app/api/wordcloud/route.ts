import { dbManager } from "@/lib/db";
import { computeWordCloud } from "@/lib/wordcloud";
import { loadEntryHtmlForRead } from "@/lib/entryEncryption";
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
        SELECT e.CategoryID, ec.HtmlContent FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE c.UserID = ? AND e.IsDeleted = 0${extra}
        ORDER BY e.ModifiedDate DESC
    `).all(...params) as { CategoryID: number; HtmlContent: string | null }[];

    // Decrypt locked-category content when the EEK is cached; skip it entirely
    // when it isn't, so raw ENC1: base64 ciphertext never pollutes the cloud.
    const texts: string[] = [];
    for (const r of rows) {
        const html = await loadEntryHtmlForRead(dbManager, userId, r.CategoryID, r.HtmlContent);
        if (html !== null) texts.push(html);
    }

    const cloud = computeWordCloud(texts, { limit, minLength });
    return NextResponse.json({ words: cloud, scannedEntries: texts.length, capped: false });
});
