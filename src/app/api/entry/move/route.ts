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

        // Self-parent guard — moving an entry under itself corrupts the tree
        if (parentId !== null && parentId === entryId) {
            return NextResponse.json({ error: "An entry cannot be its own parent" }, { status: 400 });
        }

        // Verify the entry to move belongs to this user
        const entry = await db.prepare(`
            SELECT e.CategoryID FROM Entry e JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId) as { CategoryID: number } | undefined;

        if (!entry) return NextResponse.json({ error: "Entry not found or unauthorized" }, { status: 403 });

        // Verify parent belongs to the same user (and same category to prevent cross-journal moves)
        if (parentId !== null) {
            const parent = await db.prepare(`
                SELECT e.CategoryID FROM Entry e JOIN Category c ON e.CategoryID = c.CategoryID
                WHERE e.EntryID = ? AND c.UserID = ? AND e.CategoryID = ?
            `).get(parentId, userId, entry.CategoryID) as { CategoryID: number } | undefined;

            if (!parent) {
                return NextResponse.json({ error: "Target parent not found or unauthorized" }, { status: 403 });
            }

            // Cycle guard — walk up from parentId; if we reach entryId, the move would create a loop
            // (e.g. moving a section under one of its own children). Uses a recursive CTE to walk
            // the ancestor chain efficiently in a single query.
            const cycle = await db.prepare(`
                WITH RECURSIVE ancestors(id) AS (
                    SELECT ParentEntryID FROM Entry WHERE EntryID = ?
                    UNION ALL
                    SELECT e.ParentEntryID FROM Entry e JOIN ancestors a ON e.EntryID = a.id
                    WHERE a.id IS NOT NULL
                )
                SELECT 1 FROM ancestors WHERE id = ? LIMIT 1
            `).get(parentId, entryId) as any;

            if (cycle) {
                return NextResponse.json({ error: "Cannot move an entry under one of its own descendants" }, { status: 400 });
            }
        }

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
