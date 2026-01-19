import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic'; // Prevent caching

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get('categoryId');

    if (!categoryId) {
        return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
    }

    try {
        // Fetch CreatedDate of all entries in this category
        // simple query, we will process hierarchy on client or here. Client is often easier for UI state.
        const entries = db.prepare(`
            SELECT EntryID, Title, CreatedDate, Icon, PreviewText
            FROM Entry 
            WHERE CategoryID = ?
            ORDER BY CreatedDate DESC
        `).all(categoryId);

        return NextResponse.json(entries);
    } catch (error) {
        console.error("Failed to fetch entry dates", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
