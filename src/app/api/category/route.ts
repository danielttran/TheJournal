import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/route-helpers";

const CreateCategorySchema = z.object({
    name: z.string().min(1),
    type: z.enum(['Journal', 'Notebook']),
    color: z.string().optional(),
    isPrivate: z.boolean().optional().default(true),
    isSmartbook: z.boolean().optional().default(false),
    smartbookQuery: z.string().max(4000).optional(),
    entryFrequency: z.enum(['daily', 'weekly', 'hourly']).optional(),
});

// GET: List all categories for user
export async function GET(req: NextRequest) {
    const userId = getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const categories = await db.prepare('SELECT * FROM Category WHERE UserID = ? ORDER BY SortOrder ASC').all(userId);
        return NextResponse.json(categories);
    } catch (error) {
        console.error("Failed to fetch categories:", error);
        return NextResponse.json({ error: "Failed to fetch categories" }, { status: 500 });
    }
}

// POST: Create new category
export async function POST(req: NextRequest) {
    try {
        // userId is always read from the session cookie — never from the request body.
        const userId = getUserIdFromRequest(req);
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        const { name, type, color, isPrivate, isSmartbook, smartbookQuery, entryFrequency } =
            CreateCategorySchema.parse(body);

        const result = await db.prepare(`
            INSERT INTO Category (UserID, Name, Type, Color, IsPrivate, IsSmartbook, SmartbookQuery, EntryFrequency)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId, name, type, color || '#FFFFFF', isPrivate ? 1 : 0,
            isSmartbook ? 1 : 0, smartbookQuery ?? null, entryFrequency ?? 'daily'
        );

        return NextResponse.json({ id: result.lastInsertRowid, name, type });
    } catch (error) {
        console.error("Failed to create category:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
