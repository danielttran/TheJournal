import { dbManager } from "@/lib/db";
import { pickRandomEntry } from "@/lib/random";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/random — David RM "Surprise me". Returns one random non-deleted
 * Page entry the user can open. Soft-deleted and locked entries are excluded
 * by default; ?includeLocked=1 opts in. Optional ?categoryId=N scopes the pool.
 *
 * Response: 200 { entry } | { entry: null } when the pool is empty.
 */
export const GET = authedHandler<[NextRequest]>('GET /api/random', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const cat = searchParams.get('categoryId');
    const includeLocked = searchParams.get('includeLocked') === '1';
    const categoryId = cat ? parseInt(cat, 10) : NaN;

    const entry = await pickRandomEntry(dbManager, userId, {
        categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
        includeLocked,
    });
    return NextResponse.json({ entry });
});
