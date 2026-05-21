import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { classifyMedia, MAX_UPLOAD_SIZE_BYTES } from '@/lib/uploadPolicy';
import { getUserIdFromRequest } from '@/lib/route-helpers';

export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromRequest(req);
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        const verdict = classifyMedia({ type: file.type, size: file.size });
        if (!verdict.ok) {
            const status = file.size > MAX_UPLOAD_SIZE_BYTES ? 413 : 415;
            return NextResponse.json({ error: verdict.reason }, { status });
        }
        const isVideo = verdict.kind === 'video';

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Strip path separators, NUL bytes, and other control chars from the
        // filename before storing. The MIME allowlist above already prevents
        // executable payloads — this just keeps the stored label clean so any
        // future download/UX flow doesn't have to re-sanitize.
        const rawName = typeof file.name === 'string' && file.name.length > 0 ? file.name : 'image';
         
        const safeName = rawName.replace(/[\x00-\x1f\\/:*?"<>|]+/g, '_').slice(0, 255) || 'image';

        // Store the image blob in the database so it is included in backups
        // and survives redeploys without a separate upload directory.
        const result = await db.prepare(`
            INSERT INTO Attachment (UserID, Filename, MimeType, Size, Data)
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, safeName, file.type, file.size, buffer);

        const url = `/api/attachment/${result.lastInsertRowid}`;
        return NextResponse.json({ url, kind: isVideo ? 'video' : 'image', mimeType: file.type });

    } catch (error) {
        console.error("Upload error:", error);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
