import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { Entry } from "@/lib/types";

export const dynamic = 'force-dynamic'; // Prevent caching

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const categoryId = searchParams.get('categoryId');
        const monthParam = searchParams.get('month'); // YYYY-MM

        if (!categoryId) {
            return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
        }

        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        // Verify category ownership
        const category = db.prepare('SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);
        if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });

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

        query += ` ORDER BY CreatedDate DESC`;

        const entries = db.prepare(query).all(...params) as Entry[];

        return NextResponse.json(entries);
    } catch (error) {
        console.error("Failed to fetch entry dates", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
