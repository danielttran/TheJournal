import { dbManager } from "@/lib/db";
import { deleteHabit, logHabit, unlogHabit, getHabitStatus, habitStreak } from "@/lib/habits";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const LogSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    action: z.enum(['log', 'unlog']),
});

type Params = { params: Promise<{ id: string }> };

export const GET = authedHandler<[NextRequest, Params]>('GET /api/habit/[id]', async (userId, req, { params }) => {
    const { id } = await params;
    const habitId = parseInt(id, 10);
    const { searchParams } = new URL(req.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');

    if (start && end) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
            return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
        }
        const status = await getHabitStatus(dbManager, userId, habitId, start, end);
        const streak = await habitStreak(dbManager, userId, habitId);
        return NextResponse.json({ status, streak });
    }
    const streak = await habitStreak(dbManager, userId, habitId);
    return NextResponse.json({ streak });
});

export const POST = authedHandler<[NextRequest, Params]>('POST /api/habit/[id]', async (userId, req, { params }) => {
    const { id } = await params;
    const habitId = parseInt(id, 10);
    const body = await req.json();
    const parsed = LogSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

    if (parsed.data.action === 'log') {
        await logHabit(dbManager, userId, habitId, parsed.data.date);
    } else {
        await unlogHabit(dbManager, userId, habitId, parsed.data.date);
    }
    return NextResponse.json({ success: true });
});

export const DELETE = authedHandler<[NextRequest, Params]>('DELETE /api/habit/[id]', async (userId, _req, { params }) => {
    const { id } = await params;
    await deleteHabit(dbManager, userId, parseInt(id, 10));
    return NextResponse.json({ success: true });
});
