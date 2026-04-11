import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const entryId = parseInt(id, 10);

        if (isNaN(entryId)) {
            return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
        }

        // Auth check
        const cookieStore = await cookies();
        const userId = cookieStore.get("userId")?.value;
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Verify entry belongs to user
        const ownerCheck = await db.prepare(`
            SELECT 1 FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, parseInt(userId, 10));

        if (!ownerCheck) {
            return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        }

        // Recursive CTE to get the path
        const path = await db.prepare(`
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
        const category = await db.prepare('SELECT CategoryID, Name, Type FROM Category WHERE CategoryID = ?').get(categoryId) as any;

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
            if (category?.Type === 'Journal') {
                const date = item.CreatedDate ? new Date(item.CreatedDate) : new Date();
                const year = date.getFullYear();
                const monthNumStr = String(date.getMonth() + 1).padStart(2, '0');
                const monthName = date.toLocaleString('default', { month: 'long' });
                
                // 1. Add virtual Year breadcrumb
                breadcrumbs.push({
                    id: `year-${year}`,
                    title: year.toString(),
                    type: 'Year',
                    categoryType: 'Journal'
                });

                // 2. Add virtual Month breadcrumb
                breadcrumbs.push({
                    id: `month-${year}-${monthNumStr}`,
                    title: monthName,
                    type: 'Month',
                    categoryType: 'Journal'
                });

                // 3. Add Entry (Date) breadcrumb — kept so callers can strip the
                //    last item to show "path to" rather than "path including" current.
                const day = date.getDate();
                const dayName = date.toLocaleString('default', { weekday: 'short' });
                const displayTitle = item.Title && item.Title !== 'Untitled'
                    ? item.Title
                    : `${dayName}, ${monthName.split(' ')[0]} ${day}`;

                breadcrumbs.push({
                    id: item.EntryID,
                    title: displayTitle,
                    type: item.EntryType,
                    categoryType: 'Journal'
                });
            } else {
                breadcrumbs.push({
                    id: item.EntryID,
                    title: item.Title || "Untitled",
                    type: item.EntryType
                });
            }
        });

        return NextResponse.json(breadcrumbs);
    } catch (error) {
        console.error("Path API error", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
