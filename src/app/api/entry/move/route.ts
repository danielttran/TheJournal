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

        // Update Entry
        const result = db.prepare(`
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
