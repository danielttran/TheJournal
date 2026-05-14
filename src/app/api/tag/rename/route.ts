import { dbManager } from "@/lib/db";
import { renameTag, mergeTag } from "@/lib/tagRename";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const Schema = z.object({
    from: z.string().min(1).max(60),
    to: z.string().min(1).max(60),
    mode: z.enum(['rename', 'merge']).default('rename'),
});

export const POST = authedHandler<[NextRequest]>('POST /api/tag/rename', async (userId, req) => {
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const fn = parsed.data.mode === 'merge' ? mergeTag : renameTag;
    const result = await fn(dbManager, userId, parsed.data.from, parsed.data.to);
    return NextResponse.json(result);
});
