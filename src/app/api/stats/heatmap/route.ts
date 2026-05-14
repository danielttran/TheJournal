import { dbManager } from "@/lib/db";
import { buildHeatmap } from "@/lib/heatmap";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export const GET = authedHandler<[NextRequest]>('GET /api/stats/heatmap', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const yearParam = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10);
    if (!Number.isFinite(yearParam) || yearParam < 1900 || yearParam > 9999) {
        return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }
    const cells = await buildHeatmap(dbManager, userId, yearParam);
    return NextResponse.json({ year: yearParam, cells });
});
