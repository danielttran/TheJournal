import { dbManager } from "@/lib/db";
import { updateSnippet, deleteSnippet } from "@/lib/snippets";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const UpdateSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    content: z.string().max(100_000).optional(),
    shortcut: z.string().max(40).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PUT = authedHandler<[NextRequest, Params]>('PUT /api/snippet/[id]', async (userId, req, { params }) => {
    const { id } = await params;
    const snippetId = parseInt(id, 10);
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

    try { await updateSnippet(dbManager, userId, snippetId, parsed.data); }
    catch { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
    return NextResponse.json({ success: true });
});

export const DELETE = authedHandler<[NextRequest, Params]>('DELETE /api/snippet/[id]', async (userId, _req, { params }) => {
    const { id } = await params;
    await deleteSnippet(dbManager, userId, parseInt(id, 10));
    return NextResponse.json({ success: true });
});
