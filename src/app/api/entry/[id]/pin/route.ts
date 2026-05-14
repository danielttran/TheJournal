import { db, dbManager } from "@/lib/db";
import { pinEntry, unpinEntry } from "@/lib/pin";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const POST = authedHandler<[NextRequest, Params]>('POST /api/entry/[id]/pin', async (userId, _req, { params }) => {
    const { id } = await params;
    const entryId = parseInt(id, 10);
    if (isNaN(entryId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const owns = await db.prepare(`
        SELECT e.IsPinned FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE e.EntryID = ? AND c.UserID = ?
    `).get(entryId, userId) as { IsPinned: number } | undefined;
    if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (owns.IsPinned) await unpinEntry(dbManager, entryId);
    else await pinEntry(dbManager, entryId);

    return NextResponse.json({ success: true, isPinned: !owns.IsPinned });
});
