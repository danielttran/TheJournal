import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic'; // Prevent caching

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const categoryId = searchParams.get('categoryId');
        const monthParam = searchParams.get('month'); // YYYY-MM

        let query = `
            SELECT EntryID, Title, CreatedDate, EntryType, Icon, PreviewText
            FROM Entry 
            WHERE 1=1
        `;
        const params: any[] = [];

        if (categoryId) {
            query += ` AND CategoryID = ?`;
            params.push(categoryId);
        }

        if (monthParam) {
            query += ` AND strftime('%Y-%m', CreatedDate) = ?`;
            params.push(monthParam);
        }

        query += ` ORDER BY CreatedDate DESC`; // Journal usually DESC? Or ASC? Sidebar is grouped. Grid usually ASC (Calendar order)? The SQL in page.tsx was ASC. 

        const entries = db.prepare(query).all(...params) as any[];

        return NextResponse.json(entries);
    } catch (error) {
        console.error("Failed to fetch entry dates", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
