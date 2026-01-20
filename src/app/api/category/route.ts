import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CreateCategorySchema = z.object({
    name: z.string().min(1),
    type: z.enum(['Journal', 'Notebook']),
    userId: z.number().or(z.string().transform(val => parseInt(val, 10))),
    color: z.string().optional(),
    isPrivate: z.boolean().optional().default(true)
});

// GET: List all categories for user
export async function GET(req: NextRequest) {
    // In real app, get UserID from session/auth token (cookies)
    // For now we might need to rely on query param or hardcoded for simple MVP if session not passed
    // But TabBar passes nothing. The TabBar is client component.
    // It should fetch list.
    // Let's grab userId from cookies if possible (server-side in route handler?)
    // Yes, cookies().get('userId').

    // However, route handlers in App Router can use 'next/headers'.
    const { cookies } = require("next/headers");
    const cookieStore = await cookies();
    const userIdCookie = cookieStore.get("userId");

    if (!userIdCookie) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = userIdCookie.value;

    try {
        const categories = db.prepare('SELECT * FROM Category WHERE UserID = ? ORDER BY SortOrder ASC').all(userId);
        return NextResponse.json(categories);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch categories" }, { status: 500 });
    }
}

// POST: Create new category
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { name, type, userId, color, isPrivate } = CreateCategorySchema.parse(body);

        const result = db.prepare(`
            INSERT INTO Category (UserID, Name, Type, Color, IsPrivate) 
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, name, type, color || '#FFFFFF', isPrivate ? 1 : 0);

        return NextResponse.json({ id: result.lastInsertRowid, name, type });
    } catch (error) {
        /* silence */
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
