import { dbManager } from "@/lib/db";
import { bulkSoftDelete, bulkRestore, bulkPermanentDelete, bulkAddTag, bulkRemoveTag } from "@/lib/bulk";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const Schema = z.object({
    action: z.enum(['softDelete', 'restore', 'permanentDelete', 'addTag', 'removeTag']),
    entryIds: z.array(z.number().int().positive()).min(1).max(10000),
    tag: z.string().max(60).optional(),
});

export const POST = authedHandler<[NextRequest]>('POST /api/entry/bulk', async (userId, req) => {
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const { action, entryIds, tag } = parsed.data;

    switch (action) {
        case 'softDelete':       return NextResponse.json(await bulkSoftDelete(dbManager, userId, entryIds));
        case 'restore':          return NextResponse.json(await bulkRestore(dbManager, userId, entryIds));
        case 'permanentDelete':  return NextResponse.json(await bulkPermanentDelete(dbManager, userId, entryIds));
        case 'addTag':
            if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
            return NextResponse.json(await bulkAddTag(dbManager, userId, entryIds, tag));
        case 'removeTag':
            if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
            return NextResponse.json(await bulkRemoveTag(dbManager, userId, entryIds, tag));
    }
});
