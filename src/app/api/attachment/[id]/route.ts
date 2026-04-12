import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const attachmentId = parseInt(id, 10);
        if (isNaN(attachmentId)) return new NextResponse(null, { status: 400 });

        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return new NextResponse(null, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);
        if (isNaN(userId)) return new NextResponse(null, { status: 401 });

        const row = await db.prepare(`
            SELECT Data, MimeType, Filename
            FROM Attachment
            WHERE AttachmentID = ? AND UserID = ?
        `).get(attachmentId, userId) as { Data: Buffer; MimeType: string; Filename: string } | undefined;

        if (!row) return new NextResponse(null, { status: 404 });

        // Convert Buffer → Uint8Array so NextResponse accepts it as BodyInit
        return new NextResponse(new Uint8Array(row.Data), {
            headers: {
                'Content-Type': row.MimeType,
                'Content-Disposition': `inline; filename="${encodeURIComponent(row.Filename)}"`,
                // Immutable: the blob never changes once written; safe to cache indefinitely.
                'Cache-Control': 'private, max-age=31536000, immutable',
            },
        });
    } catch (error) {
        console.error("Attachment serve error:", error);
        return new NextResponse(null, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const attachmentId = parseInt(id, 10);
        if (isNaN(attachmentId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);
        if (isNaN(userId)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const result = await db.prepare(
            'DELETE FROM Attachment WHERE AttachmentID = ? AND UserID = ?'
        ).run(attachmentId, userId);

        if (result.changes === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Attachment delete error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
