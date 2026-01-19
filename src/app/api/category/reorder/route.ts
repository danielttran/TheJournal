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
        const body = await req.json();
        const { updates } = ReorderSchema.parse(body);

        const transaction = db.transaction(() => {
            const stmt = db.prepare('UPDATE Category SET SortOrder = ? WHERE CategoryID = ?');
            for (const update of updates) {
                stmt.run(update.sortOrder, update.id);
            }
        });

        transaction();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Reorder failed", error);
        return NextResponse.json({ error: "Failed to reorder" }, { status: 500 });
    }
}
