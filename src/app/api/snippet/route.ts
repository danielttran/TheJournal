import { dbManager } from "@/lib/db";
import { createSnippet, listSnippets } from "@/lib/snippets";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
    name: z.string().min(1).max(120),
    content: z.string().max(100_000),
    shortcut: z.string().max(40).nullable().optional(),
});

export const GET = authedHandler('GET /api/snippet', async (userId) => {
    const items = await listSnippets(dbManager, userId);
    return NextResponse.json({ items });
});

export const POST = authedHandler<[NextRequest]>('POST /api/snippet', async (userId, req) => {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const id = await createSnippet(dbManager, userId, parsed.data);
    return NextResponse.json({ id });
});
