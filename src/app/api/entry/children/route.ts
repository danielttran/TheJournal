import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const parentId = searchParams.get('parentId');

    if (!parentId) {
        return NextResponse.json({ error: "Missing parentId" }, { status: 400 });
    }

    try {
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        // Verify parent entry belongs to user
        const parent = await db.prepare(`
            SELECT 1 FROM Entry e JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(parentId, userId);
        if (!parent) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const entries = await db.prepare(`
            SELECT EntryID, Title, CreatedDate, Icon, PreviewText
            FROM Entry
            WHERE ParentEntryID = ?
            ORDER BY SortOrder ASC, CreatedDate DESC
        `).all(parentId);

        return NextResponse.json(entries);
    } catch (error) {
        console.error("Failed to fetch child entries", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
