import { db } from "@/lib/db";
import { isAdminUser } from "@/lib/admin";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/users/[id] — remove an account and all of its data (David RM
 * "Manage Users"). Admin only. Refuses to delete the currently-signed-in user
 * or the last remaining account. Categories/Entries cascade by FK.
 */
export const DELETE = authedHandler<[NextRequest, { params: Promise<{ id: string }> }]>(
    'DELETE /api/users/[id]',
    async (userId, _req, { params }) => {
        if (!(await isAdminUser(userId))) return NextResponse.json({ error: 'Administrator access required' }, { status: 403 });
        const targetId = parseInt((await params).id, 10);
        if (!Number.isFinite(targetId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
        if (targetId === userId) return NextResponse.json({ error: 'You cannot delete the account you are signed in as.' }, { status: 400 });

        const count = await db.prepare('SELECT COUNT(*) AS n FROM User').get() as { n: number };
        if (count.n <= 1) return NextResponse.json({ error: 'Cannot delete the last account.' }, { status: 400 });

        const r = await db.prepare('DELETE FROM User WHERE UserID = ?').run(targetId);
        if (r.changes === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });
        return NextResponse.json({ ok: true });
    },
);
