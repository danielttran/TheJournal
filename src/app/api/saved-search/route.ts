import { dbManager } from "@/lib/db";
import { saveSearch, listSavedSearches } from "@/lib/savedSearches";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
    name: z.string().min(1).max(120),
    query: z.record(z.string(), z.unknown()).refine(
        (q) => JSON.stringify(q).length <= 20_000,
        'query JSON too large'
    ),
});

export const GET = authedHandler('GET /api/saved-search', async (userId) => {
    const items = await listSavedSearches(dbManager, userId);
    return NextResponse.json({ items });
});

export const POST = authedHandler<[NextRequest]>('POST /api/saved-search', async (userId, req) => {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const id = await saveSearch(dbManager, userId, parsed.data.name, parsed.data.query);
    return NextResponse.json({ id });
});
