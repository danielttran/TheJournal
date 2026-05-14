import { dbManager } from "@/lib/db";
import { listDistinctTags, filterEntriesByTags } from "@/lib/tags";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export const GET = authedHandler<[NextRequest]>('GET /api/tags', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const filterParam = searchParams.get('filter');

    if (filterParam) {
        const wantedTags = filterParam.split(',').map(s => s.trim()).filter(Boolean);
        const categoryIdParam = searchParams.get('categoryId');
        const categoryId = categoryIdParam ? parseInt(categoryIdParam, 10) : undefined;
        const ids = await filterEntriesByTags(dbManager, userId, wantedTags, categoryId);
        return NextResponse.json({ entryIds: ids });
    }

    const tags = await listDistinctTags(dbManager, userId);
    return NextResponse.json({ tags });
});
