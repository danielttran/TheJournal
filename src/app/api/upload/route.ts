import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Max upload size: 50MB (matches Next.js serverActions bodySizeLimit)
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

// Allowlist of image MIME types accepted for upload
const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'image/svg+xml', 'image/avif', 'image/tiff',
]);

export async function POST(req: NextRequest) {
    try {
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);
        if (isNaN(userId)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }
        if (file.size > MAX_UPLOAD_SIZE) {
            return NextResponse.json({ error: `File too large. Maximum size is ${MAX_UPLOAD_SIZE / 1024 / 1024}MB` }, { status: 413 });
        }
        if (!ALLOWED_MIME_TYPES.has(file.type)) {
            return NextResponse.json({ error: `File type "${file.type}" is not allowed` }, { status: 415 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Strip path separators, NUL bytes, and other control chars from the
        // filename before storing. The MIME allowlist above already prevents
        // executable payloads — this just keeps the stored label clean so any
        // future download/UX flow doesn't have to re-sanitize.
        const rawName = typeof file.name === 'string' && file.name.length > 0 ? file.name : 'image';
        // eslint-disable-next-line no-control-regex
        const safeName = rawName.replace(/[\x00-\x1f\\/:*?"<>|]+/g, '_').slice(0, 255) || 'image';

        // Store the image blob in the database so it is included in backups
        // and survives redeploys without a separate upload directory.
        const result = await db.prepare(`
            INSERT INTO Attachment (UserID, Filename, MimeType, Size, Data)
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, safeName, file.type, file.size, buffer);

        const url = `/api/attachment/${result.lastInsertRowid}`;
        return NextResponse.json({ url });

    } catch (error) {
        console.error("Upload error:", error);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
