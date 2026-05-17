import { db, dbManager } from "@/lib/db";
import { updateReminder, deleteReminder, toggleComplete } from "@/lib/reminders";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const UpdateSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    notes: z.string().max(10_000).nullable().optional(),
    dueAt: z.string().min(8).max(40).refine(v => !isNaN(Date.parse(v)), 'invalid date').optional(),
    entryId: z.number().int().positive().nullable().optional(),
    recurInterval: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
    recurEvery: z.number().int().min(1).max(366).nullable().optional(),
    reminderType: z.enum(['Appointment', 'Event', 'Task', 'SpecialDay']).optional(),
    status: z.enum(['active', 'done', 'skipped', 'canceled', 'missed']).optional(),
    leadMinutes: z.number().int().min(0).max(10080).optional(),
    toggle: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PUT = authedHandler<[NextRequest, Params]>('PUT /api/reminder/[id]', async (userId, req, { params }) => {
    const { id } = await params;
    const reminderId = parseInt(id, 10);
    if (isNaN(reminderId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

    if (parsed.data.entryId != null) {
        const owns = await db.prepare(`
            SELECT 1 FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(parsed.data.entryId, userId);
        if (!owns) return NextResponse.json({ error: 'Entry not found or unauthorized' }, { status: 403 });
    }

    try {
        if (parsed.data.toggle) {
            await toggleComplete(dbManager, userId, reminderId);
        }
        const { toggle: _toggle, ...rest } = parsed.data;
        if (Object.keys(rest).length > 0) {
            await updateReminder(dbManager, userId, reminderId, rest);
        }
    } catch {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
});

export const DELETE = authedHandler<[NextRequest, Params]>('DELETE /api/reminder/[id]', async (userId, _req, { params }) => {
    const { id } = await params;
    const reminderId = parseInt(id, 10);
    try {
        await deleteReminder(dbManager, userId, reminderId);
    } catch {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
});
