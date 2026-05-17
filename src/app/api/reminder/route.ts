import { db, dbManager } from "@/lib/db";
import { createReminder, listReminders, type ReminderFilter } from "@/lib/reminders";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
    title: z.string().min(1).max(200),
    notes: z.string().max(10_000).nullable().optional(),
    dueAt: z.string().min(8).max(40).refine(v => !isNaN(Date.parse(v)), 'invalid date'),
    entryId: z.number().int().positive().nullable().optional(),
    recurInterval: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
    recurEvery: z.number().int().min(1).max(366).nullable().optional(),
    reminderType: z.enum(['Appointment', 'Event', 'Task', 'SpecialDay']).optional(),
    leadMinutes: z.number().int().min(0).max(10080).optional(),
});

export const GET = authedHandler<[NextRequest]>('GET /api/reminder', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const filter = (searchParams.get('filter') ?? 'all') as ReminderFilter;
    const items = await listReminders(dbManager, userId, filter);
    return NextResponse.json({ items });
});

export const POST = authedHandler<[NextRequest]>('POST /api/reminder', async (userId, req) => {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

    if (parsed.data.entryId != null) {
        const owns = await db.prepare(`
            SELECT 1 FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(parsed.data.entryId, userId);
        if (!owns) return NextResponse.json({ error: 'Entry not found or unauthorized' }, { status: 403 });
    }

    const id = await createReminder(dbManager, userId, parsed.data);
    return NextResponse.json({ id });
});
