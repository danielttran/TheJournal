import { dbManager } from '@/lib/db';
import { findDueReminders, markReminderNotified } from '@/lib/reminderNotifications';
import { authedHandler } from '@/lib/route-helpers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reminder/due
 * Returns reminders whose notify-time has been reached and that haven't yet
 * fired a notification. The renderer polls this on a minute tick and fires
 * `new Notification(...)` for each, then POSTs to mark them notified.
 */
export const GET = authedHandler<[NextRequest]>('GET /api/reminder/due', async (userId) => {
    const items = await findDueReminders(dbManager, userId, new Date().toISOString());
    return NextResponse.json({ items });
});

const NotifySchema = z.object({
    reminderIds: z.array(z.number().int().positive()).min(1).max(50),
});

/**
 * POST /api/reminder/due
 * Body: { reminderIds: number[] } — stamps NotifiedAt on each so the next
 * poll skips them. Idempotent; foreign reminders are silently ignored.
 */
export const POST = authedHandler<[NextRequest]>('POST /api/reminder/due', async (userId, req) => {
    const body = await req.json().catch(() => ({}));
    const parsed = NotifySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    let updated = 0;
    for (const id of parsed.data.reminderIds) {
        if (await markReminderNotified(dbManager, userId, id, nowIso)) updated += 1;
    }
    return NextResponse.json({ updated });
});
