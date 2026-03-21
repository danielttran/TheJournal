import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// Max upload size: 50MB (matches Next.js serverActions bodySizeLimit)
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
    try {
        // Auth check
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        if (file.size > MAX_UPLOAD_SIZE) {
            return NextResponse.json({ error: `File too large. Maximum size is ${MAX_UPLOAD_SIZE / 1024 / 1024}MB` }, { status: 413 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Determine upload directory (public/uploads so it's accessible via URL)
        // In Electron production, this might need adjustment to User Data path + serving via custom protocol,
        // but for hybrid/web, public/uploads is standard.
        // For Electron, we might need to copy to a persistent location. 
        // Let's stick to 'public/uploads' for now, it works for dev. 
        // *Self-correction*: In Next.js production, writing to public at runtime is volatile (redeploy wipes it). 
        // But for a local-first Electron/Web app, it might be okay or expected.
        // Better: specific data directory. But serving it requires a route handler if it's strictly outside 'public'.
        // Let's use 'public/uploads' for simplicity in this prototype phase.

        const uploadDir = join(process.cwd(), 'public', 'uploads');
        await mkdir(uploadDir, { recursive: true });

        const filename = `${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_')}`;
        const filepath = join(uploadDir, filename);

        await writeFile(filepath, buffer);

        const url = `/uploads/${filename}`;
        return NextResponse.json({ url });

    } catch (error) {
        console.error("Upload error:", error);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
