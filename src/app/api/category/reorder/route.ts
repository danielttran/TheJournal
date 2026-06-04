import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/route-helpers";

const ReorderSchema = z.object({
    updates: z.array(z.object({
        id: z.number(),
        sortOrder: z.number()
    })).max(10000)
});

export async function PUT(req: NextRequest) {
    try {
        const userId = getUserIdFromRequest(req);
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        const { updates } = ReorderSchema.parse(body);

        // Only update categories belonging to this user
        const transaction = db.transaction(async () => {
            const stmt = await db.prepare('UPDATE Category SET SortOrder = ? WHERE CategoryID = ? AND UserID = ?');
            for (const update of updates) {
                // MUST await: an unawaited run() lets the enclosing transaction
                // COMMIT before (or racing with) the UPDATEs, silently dropping
                // some reorders and swallowing any SQLITE_BUSY error.
                await stmt.run(update.sortOrder, update.id, userId);
            }
        });

        await transaction();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Reorder failed", error);
        return NextResponse.json({ error: "Failed to reorder" }, { status: 500 });
    }
}
