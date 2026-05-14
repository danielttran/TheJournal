import { dbManager } from "@/lib/db";
import { listTrash, purgeOldDeletedEntries } from "@/lib/trash";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export const GET = authedHandler<[NextRequest]>('GET /api/trash', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const limitParam = parseInt(searchParams.get('limit') ?? '1000', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 1000;
    const items = await listTrash(dbManager, userId, limit);
    return NextResponse.json({ items });
});

/** Purge entries deleted more than `daysOld` (default 30) days ago — scoped to current user. */
export const DELETE = authedHandler<[NextRequest]>('DELETE /api/trash', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseInt(searchParams.get('daysOld') ?? '30', 10);
    const daysOld = Number.isFinite(parsed) && parsed >= 0 ? parsed : 30;
    const purged = await purgeOldDeletedEntries(dbManager, daysOld, userId);
    return NextResponse.json({ purged });
});
