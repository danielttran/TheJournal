import { dbManager } from "@/lib/db";
import { listRecent } from "@/lib/recent";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export const GET = authedHandler<[NextRequest]>('GET /api/entry/recent', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const limitParam = parseInt(searchParams.get('limit') ?? '20', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 20;
    const items = await listRecent(dbManager, userId, limit);
    return NextResponse.json({ items });
});
