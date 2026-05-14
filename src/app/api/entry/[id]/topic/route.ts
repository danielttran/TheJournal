import { dbManager } from "@/lib/db";
import { assignTopic, unassignTopic, topicsForEntry } from "@/lib/topics";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const MutateSchema = z.object({
    topicId: z.number().int().positive(),
    action: z.enum(['assign', 'unassign']),
});

type Params = { params: Promise<{ id: string }> };

export const GET = authedHandler<[NextRequest, Params]>('GET /api/entry/[id]/topic', async (userId, _req, { params }) => {
    const { id } = await params;
    const items = await topicsForEntry(dbManager, userId, parseInt(id, 10));
    return NextResponse.json({ items });
});

export const POST = authedHandler<[NextRequest, Params]>('POST /api/entry/[id]/topic', async (userId, req, { params }) => {
    const { id } = await params;
    const entryId = parseInt(id, 10);
    const body = await req.json();
    const parsed = MutateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
        if (parsed.data.action === 'assign') {
            await assignTopic(dbManager, userId, entryId, parsed.data.topicId);
        } else {
            await unassignTopic(dbManager, userId, entryId, parsed.data.topicId);
        }
        return NextResponse.json({ success: true });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed';
        return NextResponse.json({ error: msg }, { status: 400 });
    }
});
