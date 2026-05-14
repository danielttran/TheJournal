import { dbManager } from "@/lib/db";
import { deleteSchedule, setEnabled } from "@/lib/backupSchedule";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
    enabled: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PATCH = authedHandler<[NextRequest, Params]>('PATCH /api/backup/schedule/[id]', async (userId, req, { params }) => {
    const { id } = await params;
    const scheduleId = parseInt(id, 10);
    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    if (parsed.data.enabled !== undefined) {
        await setEnabled(dbManager, userId, scheduleId, parsed.data.enabled);
    }
    return NextResponse.json({ success: true });
});

export const DELETE = authedHandler<[NextRequest, Params]>('DELETE /api/backup/schedule/[id]', async (userId, _req, { params }) => {
    const { id } = await params;
    await deleteSchedule(dbManager, userId, parseInt(id, 10));
    return NextResponse.json({ success: true });
});
