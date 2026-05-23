import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { classifyFile, MAX_UPLOAD_SIZE_BYTES } from '@/lib/uploadPolicy';
import { getUserIdFromRequest } from '@/lib/route-helpers';

/**
 * POST /api/upload/file — generic File Attachment (David RM). Accepts any file
 * type (size-bounded), stores the blob in the Attachment table, and returns a
 * URL the editor renders as a download link. Distinct from /api/upload, which
 * only takes inline media (image/video).
 */
export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromRequest(req);
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const formData = await req.formData();
        const file = formData.get('file') as File;
        if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

        const verdict = classifyFile({ size: file.size });
        if (!verdict.ok) {
            const status = file.size > MAX_UPLOAD_SIZE_BYTES ? 413 : 400;
            return NextResponse.json({ error: verdict.reason }, { status });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const rawName = typeof file.name === 'string' && file.name.length > 0 ? file.name : 'file';
        const safeName = rawName.replace(/[\x00-\x1f\\/:*?"<>|]+/g, '_').slice(0, 255) || 'file';

        const result = await db.prepare(`
            INSERT INTO Attachment (UserID, Filename, MimeType, Size, Data)
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, safeName, file.type || 'application/octet-stream', file.size, buffer);

        return NextResponse.json({
            url: `/api/attachment/${result.lastInsertRowid}?download=1`,
            filename: safeName,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
        });
    } catch (error) {
        console.error('File upload error:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
