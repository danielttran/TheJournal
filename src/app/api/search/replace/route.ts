import { dbManager } from "@/lib/db";
import { previewReplace, executeReplace } from "@/lib/replace";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const Schema = z.object({
    categoryId: z.number().int().positive(),
    find: z.string().min(1).max(1000),
    replace: z.string().max(10_000),
    matchCase: z.boolean().default(false),
    wholeWord: z.boolean().default(false),
    preview: z.boolean().default(true),
});

export const POST = authedHandler<[NextRequest]>('POST /api/search/replace', async (userId, req) => {
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

    if (parsed.data.preview) {
        const result = await previewReplace(dbManager, userId, parsed.data);
        return NextResponse.json(result);
    }
    const result = await executeReplace(dbManager, userId, parsed.data);
    return NextResponse.json(result);
});
