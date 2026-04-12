import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";

export const dynamic = 'force-dynamic';

async function getUserId(): Promise<number | null> {
    const cookieStore = await cookies();
    const userIdCookie = cookieStore.get("userId");
    if (!userIdCookie) return null;
    return parseInt(userIdCookie.value, 10);
}

// GET /api/template — list all templates for the current user
export async function GET() {
    try {
        const userId = await getUserId();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const templates = await db.prepare(`
            SELECT TemplateID, Name, HtmlContent, QuillDelta, DocumentJson, CreatedDate
            FROM Template
            WHERE UserID = ?
            ORDER BY Name ASC
        `).all(userId);

        return NextResponse.json(templates);
    } catch (error) {
        console.error("GET /api/template error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

const CreateSchema = z.object({
    name: z.string().min(1).max(100),
    quillDelta: z.any().optional(),
    htmlContent: z.string().optional().default(''),
    documentJson: z.any().optional(),
});

// POST /api/template — create a new template
export async function POST(req: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        const { name, quillDelta, htmlContent, documentJson } = CreateSchema.parse(body);

        const result = await db.prepare(`
            INSERT INTO Template (UserID, Name, QuillDelta, HtmlContent, DocumentJson)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            userId,
            name,
            quillDelta ? JSON.stringify(quillDelta) : null,
            htmlContent,
            documentJson ? (typeof documentJson === "string" ? documentJson : JSON.stringify(documentJson)) : null
        );

        return NextResponse.json({ id: result.lastInsertRowid, name });
    } catch (error) {
        console.error("POST /api/template error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
