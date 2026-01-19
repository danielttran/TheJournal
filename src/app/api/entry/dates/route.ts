import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get('categoryId');

    if (!categoryId) {
        return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
    }

    try {
        // Fetch CreatedDate of all entries in this category
        // simple query, we will process hierarchy on client or here. Client is often easier for UI state.
        const entries = db.prepare('SELECT CreatedDate FROM Entry WHERE CategoryID = ? ORDER BY CreatedDate DESC').all(categoryId);

        // Return raw list of dates (or objects with ID if needed, but calendar logic uses date string primarily)
        // Let's return { date: string, id: number, title: string } to be useful
        const detailedEntries = db.prepare(`
            SELECT EntryID, Title, CreatedDate 
            FROM Entry 
            WHERE CategoryID = ? 
            ORDER BY CreatedDate DESC
        `).all(categoryId);

        return NextResponse.json(detailedEntries);
    } catch (error) {
        console.error("Failed to fetch entry dates", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
