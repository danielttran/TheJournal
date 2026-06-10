import { dbManager } from "@/lib/db";
import { getAllSettings, setSetting, validateDateFormat } from "@/lib/settings";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const PutSchema = z.object({
    key: z.string().min(1).max(60),
    value: z.string().max(500),
});

export const GET = authedHandler('GET /api/settings', async (userId) => {
    const map = await getAllSettings(dbManager, userId);
    return NextResponse.json({ settings: map });
});

export const PUT = authedHandler<[NextRequest]>('PUT /api/settings', async (userId, req) => {
    const body = await req.json();
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

    // Specific key validations (e.g. date format)
    if (parsed.data.key === 'dateFormat' && !validateDateFormat(parsed.data.value)) {
        return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }
    if (parsed.data.key === 'minWordsPerEntry' && !/^\d{1,7}$/.test(parsed.data.value)) {
        return NextResponse.json({ error: 'minWordsPerEntry must be a non-negative integer' }, { status: 400 });
    }

    await setSetting(dbManager, userId, parsed.data.key, parsed.data.value);
    return NextResponse.json({ success: true });
});
