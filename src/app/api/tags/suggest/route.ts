import { dbManager } from "@/lib/db";
import { suggestTags } from "@/lib/tags";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/tags/suggest?prefix=tra&limit=10 — autocomplete suggestions for
 * the editor's tag input. Empty prefix → top-N most-used. Case-insensitive.
 */
export const GET = authedHandler<[NextRequest]>('GET /api/tags/suggest', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const prefix = searchParams.get('prefix') ?? '';
    const limParam = parseInt(searchParams.get('limit') ?? '10', 10);
    const limit = Number.isFinite(limParam) && limParam > 0 ? Math.min(limParam, 50) : 10;
    const suggestions = await suggestTags(dbManager, userId, prefix, limit);
    return NextResponse.json({ suggestions });
});
