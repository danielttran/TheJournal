import { dbManager } from "@/lib/db";
import { hourActivity } from "@/lib/hourActivity";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export const GET = authedHandler<[NextRequest]>('GET /api/stats/hour-activity', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const daysParam = parseInt(searchParams.get('days') ?? '30', 10);
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 3650) : 30;
    const buckets = await hourActivity(dbManager, userId, days);
    return NextResponse.json({ days, buckets });
});
