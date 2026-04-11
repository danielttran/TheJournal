import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { Entry } from "@/lib/types";

export const dynamic = 'force-dynamic'; // Prevent caching

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const categoryId = searchParams.get('categoryId');
        const monthParam = searchParams.get('month'); // YYYY-MM
        const yearParam  = searchParams.get('year');  // YYYY

        if (!categoryId) {
            return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
        }

        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        // Verify category ownership
        const category = await db.prepare('SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);
        if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });

        // Year-level request: return one synthetic row per distinct month
        if (yearParam && !monthParam) {
            const rows = await db.prepare(`
                SELECT strftime('%Y-%m', CreatedDate) AS monthKey,
                       COUNT(*) AS entryCount
                FROM Entry
                WHERE CategoryID = ? AND strftime('%Y', CreatedDate) = ?
                GROUP BY monthKey
                ORDER BY monthKey ASC
            `).all(categoryId, yearParam) as { monthKey: string; entryCount: number }[];

            const monthEntries = rows.map(row => {
                const [y, m] = row.monthKey.split('-').map(Number);
                const monthName = new Date(y, m - 1).toLocaleString('default', { month: 'long' });
                return {
                    // Use negative synthetic IDs so clients can distinguish virtual rows
                    EntryID: -(m),
                    Title: monthName,
                    CreatedDate: `${row.monthKey}-01`,
                    PreviewText: `${row.entryCount} ${row.entryCount === 1 ? 'entry' : 'entries'}`,
                    EntryType: 'Folder',
                    Icon: null,
                    SortOrder: m,
                    _monthKey: row.monthKey,   // extra field for correct navigation
                } as any;
            });

            return NextResponse.json(monthEntries);
        }

        let query = `
            SELECT EntryID, Title, CreatedDate, EntryType, Icon, PreviewText
            FROM Entry
            WHERE CategoryID = ?
        `;
        const params: (string | number)[] = [categoryId];

        if (monthParam) {
            query += ` AND strftime('%Y-%m', CreatedDate) = ?`;
            params.push(monthParam);
        }

        query += ` ORDER BY CreatedDate ASC`;

        const entries = await db.prepare(query).all(...params) as Entry[];

        return NextResponse.json(entries);
    } catch (error) {
        console.error("Failed to fetch entry dates", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
