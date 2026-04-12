import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";

async function getUserId(): Promise<number | null> {
    const cookieStore = await cookies();
    const userIdCookie = cookieStore.get("userId");
    if (!userIdCookie) return null;
    return parseInt(userIdCookie.value, 10);
}

const UpdateSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    htmlContent: z.string().optional(),
    documentJson: z.any().optional(),
});

// PUT /api/template/[id] — rename or update content of a template
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { id } = await params;
        const templateId = parseInt(id, 10);

        const existing = await db.prepare(
            'SELECT 1 FROM Template WHERE TemplateID = ? AND UserID = ?'
        ).get(templateId, userId);
        if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

        const body = await req.json();
        const { name, htmlContent, documentJson } = UpdateSchema.parse(body);

        const updates: string[] = [];
        const values: (string | number | null)[] = [];

        if (name !== undefined) { updates.push("Name = ?"); values.push(name); }
        if (htmlContent !== undefined) { updates.push("HtmlContent = ?"); values.push(htmlContent); }
        if (documentJson !== undefined) {
            updates.push("DocumentJson = ?");
            values.push(typeof documentJson === "string" ? documentJson : JSON.stringify(documentJson));
        }

        if (updates.length > 0) {
            values.push(templateId);
            await db.prepare(`UPDATE Template SET ${updates.join(", ")} WHERE TemplateID = ?`).run(...values);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("PUT /api/template/[id] error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// DELETE /api/template/[id] — delete a template
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { id } = await params;
        const templateId = parseInt(id, 10);

        const result = await db.prepare(
            'DELETE FROM Template WHERE TemplateID = ? AND UserID = ?'
        ).run(templateId, userId);

        if (result.changes === 0) {
            return NextResponse.json({ error: "Template not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("DELETE /api/template/[id] error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
