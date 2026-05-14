import { dbManager } from "@/lib/db";
import { updateTopic, deleteTopic } from "@/lib/topics";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const UpdateSchema = z.object({
    name: z.string().min(1).max(60).optional(),
    color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
    hotkey: z.number().int().min(0).max(9).nullable().optional(),
    sortOrder: z.number().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PUT = authedHandler<[NextRequest, Params]>('PUT /api/topic/[id]', async (userId, req, { params }) => {
    const { id } = await params;
    const topicId = parseInt(id, 10);
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
        await updateTopic(dbManager, userId, topicId, parsed.data);
        return NextResponse.json({ success: true });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update';
        return NextResponse.json({ error: msg }, { status: 400 });
    }
});

export const DELETE = authedHandler<[NextRequest, Params]>('DELETE /api/topic/[id]', async (userId, _req, { params }) => {
    const { id } = await params;
    await deleteTopic(dbManager, userId, parseInt(id, 10));
    return NextResponse.json({ success: true });
});
