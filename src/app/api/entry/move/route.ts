import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const MoveEntrySchema = z.object({
    entryId: z.number(),
    parentId: z.number().nullable(),
    sortOrder: z.number(),
});

export async function PUT(req: NextRequest) {
    try {
        const body = await req.json();
        const { entryId, parentId, sortOrder } = MoveEntrySchema.parse(body);

        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        // Verify entry belongs to user
        const entry = await db.prepare(`
            SELECT 1 FROM Entry e JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId);
        if (!entry) return NextResponse.json({ error: "Entry not found or unauthorized" }, { status: 403 });

        // Update Entry
        const result = await db.prepare(`
            UPDATE Entry
            SET ParentEntryID = ?, SortOrder = ?, ModifiedDate = CURRENT_TIMESTAMP
            WHERE EntryID = ?
        `).run(parentId, sortOrder, entryId);

        if (result.changes === 0) {
            return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Error moving entry:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
