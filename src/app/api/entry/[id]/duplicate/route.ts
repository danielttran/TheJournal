import { dbManager } from "@/lib/db";
import { duplicateEntry } from "@/lib/duplicate";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const Schema = z.object({
    targetCategoryId: z.number().int().positive().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const POST = authedHandler<[NextRequest, Params]>('POST /api/entry/[id]/duplicate', async (userId, req, { params }) => {
    const { id } = await params;
    const entryId = parseInt(id, 10);
    if (isNaN(entryId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    // Body is optional — accept empty body for same-category clone
    let targetCategoryId: number | undefined;
    try {
        const body = await req.json();
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
        targetCategoryId = parsed.data.targetCategoryId;
    } catch { /* no body / not JSON — same-cat clone */ }

    try {
        const newId = await duplicateEntry(dbManager, userId, entryId, targetCategoryId);
        return NextResponse.json({ id: newId });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to duplicate';
        return NextResponse.json({ error: msg }, { status: 400 });
    }
});
