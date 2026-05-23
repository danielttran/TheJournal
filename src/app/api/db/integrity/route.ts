import { dbManager } from "@/lib/db";
import { checkIntegrity } from "@/lib/dbMaintenance";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/** GET /api/db/integrity — runs PRAGMA integrity_check (David RM repair). */
export const GET = authedHandler<[NextRequest]>(
    'GET /api/db/integrity',
    async () => {
        const res = await checkIntegrity(dbManager);
        return NextResponse.json(res);
    },
);
