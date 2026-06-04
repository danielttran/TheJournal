import { dbManager } from "@/lib/db";
import { checkIntegrity } from "@/lib/dbMaintenance";
import { isAdminUser } from "@/lib/admin";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/** GET /api/db/integrity — runs PRAGMA integrity_check (David RM repair). */
export const GET = authedHandler<[NextRequest]>(
    'GET /api/db/integrity',
    async (userId) => {
        // Whole-DB maintenance op — keep it consistent with optimize/export and
        // restrict to the bootstrap admin (no-op on single-user installs).
        if (!(await isAdminUser(userId))) {
            return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
        }
        const res = await checkIntegrity(dbManager);
        return NextResponse.json(res);
    },
);
