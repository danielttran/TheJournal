import { dbManager } from "@/lib/db";
import { snoozeReminder } from "@/lib/reminderSnooze";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const Schema = z.object({
    minutes: z.number().int().positive().max(60 * 24 * 365),
});

type Params = { params: Promise<{ id: string }> };

export const POST = authedHandler<[NextRequest, Params]>('POST /api/reminder/[id]/snooze', async (userId, req, { params }) => {
    const { id } = await params;
    const reminderId = parseInt(id, 10);
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
        await snoozeReminder(dbManager, userId, reminderId, parsed.data.minutes);
        return NextResponse.json({ success: true });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 400 });
    }
});
