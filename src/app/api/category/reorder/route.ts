import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

const ReorderSchema = z.object({
    updates: z.array(z.object({
        id: z.number(),
        sortOrder: z.number()
    }))
});

export async function PUT(req: NextRequest) {
    try {
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        const body = await req.json();
        const { updates } = ReorderSchema.parse(body);

        // Only update categories belonging to this user
        const transaction = db.transaction(async () => {
            const stmt = await db.prepare('UPDATE Category SET SortOrder = ? WHERE CategoryID = ? AND UserID = ?');
            for (const update of updates) {
                stmt.run(update.sortOrder, update.id, userId);
            }
        });

        await transaction();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Reorder failed", error);
        return NextResponse.json({ error: "Failed to reorder" }, { status: 500 });
    }
}
