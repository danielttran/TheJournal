import { dbManager } from "@/lib/db";
import { createSchedule, listSchedules } from "@/lib/backupSchedule";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const Schema = z.object({
    intervalDays: z.number().int().min(1).max(365),
    destPath: z.string().min(1).max(500),
});

export const GET = authedHandler('GET /api/backup/schedule', async (userId) => {
    const items = await listSchedules(dbManager, userId);
    return NextResponse.json({ items });
});

export const POST = authedHandler<[NextRequest]>('POST /api/backup/schedule', async (userId, req) => {
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const id = await createSchedule(dbManager, userId, parsed.data);
    return NextResponse.json({ id });
});
