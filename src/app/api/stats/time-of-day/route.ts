import { dbManager } from "@/lib/db";
import { entriesByHour, entriesByWeekday } from "@/lib/stats";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/stats/time-of-day — returns both distributions in one round-trip
 * so the stats panel can render the hour-of-day and day-of-week charts side
 * by side.
 *
 * Response: { byHour: [{hour, count}×24], byWeekday: [{weekday, count}×7] }
 */
export const GET = authedHandler<[NextRequest]>('GET /api/stats/time-of-day', async (userId) => {
    const [byHour, byWeekday] = await Promise.all([
        entriesByHour(dbManager, userId),
        entriesByWeekday(dbManager, userId),
    ]);
    return NextResponse.json({ byHour, byWeekday });
});
