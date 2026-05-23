import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/** GET /api/users — list accounts (David RM "Manage Users"). */
export const GET = authedHandler<[NextRequest]>(
    'GET /api/users',
    async () => {
        const rows = await db.prepare('SELECT UserID, Username FROM User ORDER BY Username').all();
        return NextResponse.json(rows);
    },
);

/** POST /api/users — provision a new account. body: { username, password } */
export const POST = authedHandler<[NextRequest]>(
    'POST /api/users',
    async (_userId, req) => {
        const body = await req.json().catch(() => null) as { username?: unknown; password?: unknown } | null;
        const username = typeof body?.username === 'string' ? body.username.trim() : '';
        const password = typeof body?.password === 'string' ? body.password : '';
        if (username.length < 1) return NextResponse.json({ error: 'Username required' }, { status: 400 });
        if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });

        const exists = await db.prepare('SELECT 1 FROM User WHERE Username = ?').get(username);
        if (exists) return NextResponse.json({ error: 'Username already taken' }, { status: 409 });

        const hash = await hashPassword(password);
        const r = await db.prepare('INSERT INTO User (Username, PasswordHash) VALUES (?, ?)').run(username, hash);
        return NextResponse.json({ ok: true, id: r.lastInsertRowid, username });
    },
);
