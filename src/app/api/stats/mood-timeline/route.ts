import { dbManager } from "@/lib/db";
import { moodByMonth } from "@/lib/stats";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/stats/mood-timeline?months=12 — stacked mood counts per month for
 * the stats panel chart. Caps the window at 48 months so a tampered URL
 * can't pull years of buckets.
 */
export const GET = authedHandler<[NextRequest]>('GET /api/stats/mood-timeline', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const param = parseInt(searchParams.get('months') ?? '12', 10);
    const months = Number.isFinite(param) && param > 0 ? Math.min(param, 48) : 12;
    const timeline = await moodByMonth(dbManager, userId, months);
    return NextResponse.json({ months, timeline });
});
