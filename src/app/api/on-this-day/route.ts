import { dbManager } from "@/lib/db";
import { onThisDay } from "@/lib/anniversary";
import { authedHandler } from "@/lib/route-helpers";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export const GET = authedHandler('GET /api/on-this-day', async (userId) => {
    const items = await onThisDay(dbManager, userId, new Date());
    return NextResponse.json({ items });
});
