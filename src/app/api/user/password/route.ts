import { dbManager } from "@/lib/db";
import { changeUserPassword } from "@/lib/userPassword";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/** POST /api/user/password — change the login password (David RM). */
export const POST = authedHandler<[NextRequest]>(
    'POST /api/user/password',
    async (userId, req) => {
        const body = await req.json().catch(() => null) as
            | { oldPassword?: unknown; newPassword?: unknown }
            | null;
        const oldPassword = typeof body?.oldPassword === 'string' ? body.oldPassword : '';
        const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

        const res = await changeUserPassword(dbManager, userId, oldPassword, newPassword);
        if (res.ok) return NextResponse.json({ ok: true });

        const status = res.reason === 'not-found' ? 404
            : res.reason === 'wrong-password' ? 403
            : 400;
        return NextResponse.json({ ok: false, reason: res.reason }, { status });
    },
);
