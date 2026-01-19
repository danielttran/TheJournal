import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get('categoryId');

    if (!categoryId) {
        return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
    }

    try {
        const entries = db.prepare(`
            SELECT EntryID, Title, ParentEntryID, EntryType, SortOrder, Icon
            FROM Entry 
            WHERE CategoryID = ?
            ORDER BY SortOrder ASC
        `).all(categoryId);
        return NextResponse.json(entries);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 });
    }
}
