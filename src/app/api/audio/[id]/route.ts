import { dbManager } from "@/lib/db";
import { loadVoiceMemoData, deleteVoiceMemo } from "@/lib/audio";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

async function lookupMime(userId: number, attachmentId: number): Promise<string | null> {
    const row = await dbManager.prepare(
        `SELECT MimeType FROM Attachment
         WHERE AttachmentID = ? AND UserID = ? AND MimeType LIKE 'audio/%'`
    ).get(attachmentId, userId) as { MimeType: string } | undefined;
    return row?.MimeType ?? null;
}

/**
 * GET /api/audio/:id — stream the raw audio bytes back. Cross-user requests
 * and non-audio attachments return 404.
 */
export const GET = authedHandler<[NextRequest, { params: Promise<{ id: string }> }]>(
    'GET /api/audio/[id]',
    async (userId, _req, { params }) => {
        const { id } = await params;
        const attachmentId = parseInt(id, 10);
        if (!Number.isFinite(attachmentId)) {
            return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
        }
        const mime = await lookupMime(userId, attachmentId);
        if (!mime) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const buf = await loadVoiceMemoData(dbManager, userId, attachmentId);
        if (!buf) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return new NextResponse(new Uint8Array(buf), {
            status: 200,
            headers: {
                'content-type': mime,
                'content-length': String(buf.length),
                'cache-control': 'private, max-age=0',
            },
        });
    },
);

export const DELETE = authedHandler<[NextRequest, { params: Promise<{ id: string }> }]>(
    'DELETE /api/audio/[id]',
    async (userId, _req, { params }) => {
        const { id } = await params;
        const attachmentId = parseInt(id, 10);
        if (!Number.isFinite(attachmentId)) {
            return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
        }
        const ok = await deleteVoiceMemo(dbManager, userId, attachmentId);
        if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json({ deleted: true });
    },
);
