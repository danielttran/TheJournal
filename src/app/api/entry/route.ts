import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get('categoryId');

    if (!categoryId) {
        return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
    }

    try {
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        // Verify category ownership
        const category = db.prepare('SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);
        if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });

        const entries = db.prepare(`
            SELECT EntryID, Title, ParentEntryID, EntryType, SortOrder, Icon, IsExpanded
            FROM Entry
            WHERE CategoryID = ?
            ORDER BY SortOrder ASC
        `).all(categoryId);
        return NextResponse.json(entries);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 });
    }
}
