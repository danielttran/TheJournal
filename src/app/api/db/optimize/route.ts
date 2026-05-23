import { dbManager } from "@/lib/db";
import { optimizeDatabase } from "@/lib/dbMaintenance";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/** POST /api/db/optimize — checkpoints the WAL and VACUUMs (defragment). */
export const POST = authedHandler<[NextRequest]>(
    'POST /api/db/optimize',
    async () => {
        const res = await optimizeDatabase(dbManager);
        return NextResponse.json(res);
    },
);
