import { dbManager } from "@/lib/db";
import { findBacklinks } from "@/lib/backlinks";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const GET = authedHandler<[NextRequest, Params]>('GET /api/entry/[id]/backlinks', async (userId, _req, { params }) => {
    const { id } = await params;
    const entryId = parseInt(id, 10);
    if (isNaN(entryId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const items = await findBacklinks(dbManager, userId, entryId);
    return NextResponse.json({ items });
});
