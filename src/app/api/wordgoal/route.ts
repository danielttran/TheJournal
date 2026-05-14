import { db, dbManager } from "@/lib/db";
import { createGoal, getActiveGoals, computeProgress, type GoalType } from "@/lib/wordgoals";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
    type: z.enum(['daily', 'total']),
    target: z.number().int().positive().max(10_000_000),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullable().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
});

export const GET = authedHandler('GET /api/wordgoal', async (userId) => {
    const goals = await getActiveGoals(dbManager, userId);
    const withProgress = await Promise.all(goals.map(async g => {
        const progress = await computeProgress(dbManager, userId, {
            type: g.Type as GoalType,
            target: g.Target,
            startDate: g.StartDate,
            endDate: g.EndDate,
            categoryId: g.CategoryID,
        });
        return { ...g, ...progress };
    }));
    return NextResponse.json({ goals: withProgress });
});

export const POST = authedHandler<[NextRequest]>('POST /api/wordgoal', async (userId, req) => {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

    if (parsed.data.categoryId != null) {
        const owns = await db.prepare('SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?')
            .get(parsed.data.categoryId, userId);
        if (!owns) return NextResponse.json({ error: 'Category not found or unauthorized' }, { status: 403 });
    }

    const id = await createGoal(dbManager, userId, parsed.data);
    return NextResponse.json({ id });
});
