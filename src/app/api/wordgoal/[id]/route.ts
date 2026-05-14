import { dbManager } from "@/lib/db";
import { deleteGoal } from "@/lib/wordgoals";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const DELETE = authedHandler<[NextRequest, Params]>('DELETE /api/wordgoal/[id]', async (userId, _req, { params }) => {
    const { id } = await params;
    await deleteGoal(dbManager, userId, parseInt(id, 10));
    return NextResponse.json({ success: true });
});
