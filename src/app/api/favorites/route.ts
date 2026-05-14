import { dbManager } from "@/lib/db";
import { listFavorites, toggleFavorite } from "@/lib/favorites";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/favorites — list the user's starred entries, newest-modified first.
 *   ?categoryId=N to scope to a journal/notebook.
 *   ?limit=N to cap the result.
 */
export const GET = authedHandler<[NextRequest]>('GET /api/favorites', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const cat = searchParams.get('categoryId');
    const lim = searchParams.get('limit');
    const categoryId = cat ? parseInt(cat, 10) : NaN;
    const limit = lim ? parseInt(lim, 10) : NaN;

    const favorites = await listFavorites(dbManager, userId, {
        categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
        limit:      Number.isFinite(limit)      ? limit      : undefined,
    });
    return NextResponse.json({ favorites });
});

/**
 * POST /api/favorites — body { entryId: number } toggles the star and
 * returns { isFavorited: boolean } | 404 when the entry is missing / not the
 * user's. Single atomic UPDATE; cross-user requests are rejected at the
 * lib layer.
 */
export const POST = authedHandler<[NextRequest]>('POST /api/favorites', async (userId, req) => {
    const body = await req.json().catch(() => null);
    const entryId = body && typeof body.entryId === 'number' ? body.entryId : NaN;
    if (!Number.isFinite(entryId)) {
        return NextResponse.json({ error: 'entryId (number) required' }, { status: 400 });
    }
    const isFavorited = await toggleFavorite(dbManager, userId, entryId);
    if (isFavorited === null) {
        return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
    return NextResponse.json({ isFavorited });
});
