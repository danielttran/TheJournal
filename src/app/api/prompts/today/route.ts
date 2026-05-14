import { promptOfTheDay } from "@/lib/dailyPrompts";
import { authedHandler } from "@/lib/route-helpers";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export const GET = authedHandler('GET /api/prompts/today', async () => {
    const prompt = promptOfTheDay(new Date());
    return NextResponse.json({ date: new Date().toISOString().slice(0, 10), prompt });
});
