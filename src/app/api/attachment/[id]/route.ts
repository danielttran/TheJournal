import { db } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const attachmentId = parseInt(id, 10);
        if (isNaN(attachmentId)) return new NextResponse(null, { status: 400 });

        const userId = getUserIdFromRequest(req);
        if (!userId) return new NextResponse(null, { status: 401 });

        const row = await db.prepare(`
            SELECT Data, MimeType, Filename
            FROM Attachment
            WHERE AttachmentID = ? AND UserID = ?
        `).get(attachmentId, userId) as { Data: Buffer; MimeType: string; Filename: string } | undefined;

        if (!row) return new NextResponse(null, { status: 404 });

        // Only render inline for media that browsers can't turn into a script
        // host. SVG and HTML/XML can carry <script>, so they're always forced to
        // download regardless of ?download — otherwise a stored .svg/.html
        // attachment would execute as same-origin script when its URL is opened.
        const mime = (row.MimeType || '').toLowerCase();
        const inlineSafe =
            (mime.startsWith('image/') && mime !== 'image/svg+xml') ||
            mime.startsWith('video/') || mime.startsWith('audio/') ||
            mime === 'application/pdf';
        const wantsDownload = new URL(req.url).searchParams.get('download') === '1';
        const disposition = (wantsDownload || !inlineSafe) ? 'attachment' : 'inline';

        // Convert Buffer → Uint8Array so NextResponse accepts it as BodyInit
        return new NextResponse(new Uint8Array(row.Data), {
            headers: {
                'Content-Type': row.MimeType,
                'Content-Disposition': `${disposition}; filename="${encodeURIComponent(row.Filename)}"`,
                // Defence in depth: never sniff a declared type into something
                // executable, and forbid any script/subresource if the blob is
                // ever rendered as a document.
                'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy': "default-src 'none'; sandbox; style-src 'unsafe-inline'; img-src 'self' data:",
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

        const userId = getUserIdFromRequest(req);
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
