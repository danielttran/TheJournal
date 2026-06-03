import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/route-helpers";

const MoveEntrySchema = z.object({
    entryId: z.number(),
    parentId: z.number().nullable(),
    sortOrder: z.number(),
});

export async function PUT(req: NextRequest) {
    try {
        const body = await req.json();
        const { entryId, parentId, sortOrder } = MoveEntrySchema.parse(body);

        const userId = getUserIdFromRequest(req);
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
        }

        // The cycle guard + UPDATE MUST run in one transaction (BEGIN IMMEDIATE).
        // Otherwise two concurrent moves can each individually pass the cycle
        // check and both commit, producing a parent/child cycle that later
        // breaks the recursive subtree CTEs in trash/bulk.
        const moveTx = db.transaction(async () => {
            if (parentId !== null) {
                // Walk up from parentId; if we reach entryId the move would loop.
                const cycle = await db.prepare(`
                    WITH RECURSIVE ancestors(id) AS (
                        SELECT ParentEntryID FROM Entry WHERE EntryID = ?
                        UNION ALL
                        SELECT e.ParentEntryID FROM Entry e JOIN ancestors a ON e.EntryID = a.id
                        WHERE a.id IS NOT NULL
                    )
                    SELECT 1 FROM ancestors WHERE id = ? LIMIT 1
                `).get(parentId, entryId) as { 1: number } | undefined;
                if (cycle) return { cycle: true as const, changes: 0 };
            }
            const result = await db.prepare(`
                UPDATE Entry
                SET ParentEntryID = ?, SortOrder = ?, ModifiedDate = CURRENT_TIMESTAMP
                WHERE EntryID = ?
            `).run(parentId, sortOrder, entryId);
            return { cycle: false as const, changes: result.changes };
        });
        const outcome = await moveTx();

        if (outcome.cycle) {
            return NextResponse.json({ error: "Cannot move an entry under one of its own descendants" }, { status: 400 });
        }
        if (outcome.changes === 0) {
            return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Error moving entry:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
