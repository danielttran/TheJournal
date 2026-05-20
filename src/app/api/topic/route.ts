import { dbManager } from "@/lib/db";
import { createTopic, listTopics } from "@/lib/topics";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
    name: z.string().min(1).max(60),
    color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
    hotkey: z.number().int().min(0).max(9).nullable().optional(),
    sortOrder: z.number().optional(),
    parentTopicId: z.number().int().positive().nullable().optional(),
});

export const GET = authedHandler('GET /api/topic', async (userId) => {
    const items = await listTopics(dbManager, userId);
    return NextResponse.json({ items });
});

export const POST = authedHandler<[NextRequest]>('POST /api/topic', async (userId, req) => {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
        const id = await createTopic(dbManager, userId, parsed.data);
        return NextResponse.json({ id });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create topic';
        return NextResponse.json({ error: msg }, { status: 400 });
    }
});
