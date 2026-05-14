import { dbManager } from "@/lib/db";
import {
    totalEntries, totalWords, entriesPerDay,
    longestStreak, currentStreak, topTags, topMoods,
} from "@/lib/stats";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export const GET = authedHandler<[NextRequest]>('GET /api/stats', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const daysParam = parseInt(searchParams.get('days') ?? '30', 10);
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;

    const [entries, words, series, longest, current, tags, moods] = await Promise.all([
        totalEntries(dbManager, userId),
        totalWords(dbManager, userId),
        entriesPerDay(dbManager, userId, days),
        longestStreak(dbManager, userId),
        currentStreak(dbManager, userId),
        topTags(dbManager, userId, 10),
        topMoods(dbManager, userId, 10),
    ]);

    return NextResponse.json({
        totals: { entries, words },
        streaks: { longest, current },
        series,
        topTags: tags,
        topMoods: moods,
    });
});
