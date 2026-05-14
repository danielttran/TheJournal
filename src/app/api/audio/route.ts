import { dbManager } from "@/lib/db";
import { listVoiceMemos, saveVoiceMemo, isAudioMime } from "@/lib/audio";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;   // 25 MB per memo — generous but bounded

/**
 * GET /api/audio?limit=N — voice memo list, newest first. Metadata only;
 * the binary payload is fetched on-demand via /api/audio/[id].
 */
export const GET = authedHandler<[NextRequest]>('GET /api/audio', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const lim = parseInt(searchParams.get('limit') ?? '', 10);
    const memos = await listVoiceMemos(dbManager, userId, Number.isFinite(lim) && lim > 0 ? lim : undefined);
    return NextResponse.json({ memos });
});

/**
 * POST /api/audio — multipart/form-data upload. Fields: file (the audio
 * blob), filename (optional override). MIME type comes from the upload.
 */
export const POST = authedHandler<[NextRequest]>('POST /api/audio', async (userId, req) => {
    const form = await req.formData().catch(() => null);
    if (!form) {
        return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 });
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
        return NextResponse.json({ error: 'file field required' }, { status: 400 });
    }
    if (!isAudioMime(file.type)) {
        return NextResponse.json({ error: 'file must be audio/*' }, { status: 415 });
    }
    if (file.size === 0) {
        return NextResponse.json({ error: 'empty payload' }, { status: 400 });
    }
    if (file.size > MAX_AUDIO_BYTES) {
        return NextResponse.json({ error: 'payload too large' }, { status: 413 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const filenameField = form.get('filename');
    const filename = typeof filenameField === 'string' && filenameField.trim().length > 0
        ? filenameField.trim()
        : file.name || `memo-${Date.now()}`;

    const id = await saveVoiceMemo(dbManager, {
        userId,
        filename,
        mimeType: file.type,
        data: buf,
    });
    return NextResponse.json({ attachmentId: id });
});
