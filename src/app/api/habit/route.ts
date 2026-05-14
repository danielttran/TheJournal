import { dbManager } from "@/lib/db";
import { createHabit, listHabits } from "@/lib/habits";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
    name: z.string().min(1).max(80),
    color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
    goal: z.number().int().min(1).max(100).optional(),
});

export const GET = authedHandler('GET /api/habit', async (userId) => {
    const items = await listHabits(dbManager, userId);
    return NextResponse.json({ items });
});

export const POST = authedHandler<[NextRequest]>('POST /api/habit', async (userId, req) => {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const id = await createHabit(dbManager, userId, parsed.data);
    return NextResponse.json({ id });
});
