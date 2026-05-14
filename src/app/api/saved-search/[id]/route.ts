import { dbManager } from "@/lib/db";
import { deleteSavedSearch } from "@/lib/savedSearches";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const DELETE = authedHandler<[NextRequest, Params]>('DELETE /api/saved-search/[id]', async (userId, _req, { params }) => {
    const { id } = await params;
    await deleteSavedSearch(dbManager, userId, parseInt(id, 10));
    return NextResponse.json({ success: true });
});
