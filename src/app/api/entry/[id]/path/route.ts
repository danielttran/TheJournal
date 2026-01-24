import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const entryId = parseInt(id, 10);

        if (isNaN(entryId)) {
            return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
        }

        // Recursive CTE to get the path
        const path = db.prepare(`
            WITH RECURSIVE Path(EntryID, Title, ParentEntryID, EntryType, CategoryID, Depth) AS (
                SELECT EntryID, Title, ParentEntryID, EntryType, CategoryID, 0
                FROM Entry
                WHERE EntryID = ?
                UNION ALL
                SELECT e.EntryID, e.Title, e.ParentEntryID, e.EntryType, e.CategoryID, p.Depth + 1
                FROM Entry e
                JOIN Path p ON e.EntryID = p.ParentEntryID
            )
            SELECT EntryID, Title, EntryType, CategoryID FROM Path ORDER BY Depth DESC;
        `).all(entryId) as any[];

        if (path.length === 0) {
            return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        }

        // Get Category name
        const categoryId = path[0].CategoryID;
        const category = db.prepare('SELECT CategoryID, Name, Type FROM Category WHERE CategoryID = ?').get(categoryId) as any;

        const breadcrumbs = [];
        if (category) {
            breadcrumbs.push({
                id: category.CategoryID,
                title: category.Name,
                type: 'Category',
                categoryType: category.Type
            });
        }

        path.forEach(item => {
            breadcrumbs.push({
                id: item.EntryID,
                title: item.Title || "Untitled",
                type: item.EntryType
            });
        });

        return NextResponse.json(breadcrumbs);
    } catch (error) {
        console.error("Path API error", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
