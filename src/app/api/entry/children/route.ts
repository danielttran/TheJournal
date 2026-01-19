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
        const entries = db.prepare(`
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
