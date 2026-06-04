import { dbManager } from "@/lib/db";
import { optimizeDatabase } from "@/lib/dbMaintenance";
import { isAdminUser } from "@/lib/admin";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/** POST /api/db/optimize — checkpoints the WAL and VACUUMs (defragment). */
export const POST = authedHandler<[NextRequest]>(
    'POST /api/db/optimize',
    async (userId) => {
        // VACUUM rewrites the entire shared DB under an exclusive lock, which
        // stalls every tenant — keep it admin-only (no-op on single-user).
        if (!(await isAdminUser(userId))) {
            return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
        }
        const res = await optimizeDatabase(dbManager);
        return NextResponse.json(res);
    },
);
