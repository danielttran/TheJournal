import { join } from 'path';
import { copyFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
    try {
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 1. Locate the live encrypted DB file
        const sourcePath = process.env.JOURNAL_DB_PATH || join(process.cwd(), 'journal.tjdb');
        console.log('[Export API] Attempting export from:', sourcePath);

        if (!existsSync(sourcePath)) {
            console.error('[Export API] Database file not found at:', sourcePath);
            return NextResponse.json({ error: "Database file not found." }, { status: 404 });
        }

        // 2. Validate that there is data to export
        const liveCount = await db.prepare("SELECT count(*) as c FROM Category").get() as any;
        if (liveCount.c === 0) {
            return NextResponse.json({ error: "Export Aborted: The current database is empty." }, { status: 400 });
        }

        // 3. Read the encrypted DB file
        const { readFile } = await import('fs/promises');
        const fileBuffer = await readFile(sourcePath);
        const filename = `journal-backup-${new Date().toISOString().split('T')[0]}.tjdb`;

        return new Response(fileBuffer, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': fileBuffer.length.toString()
            }
        });
    } catch (error: any) {
        console.error("Export failed", error);
        return NextResponse.json({ error: error.message || "Failed to export database" }, { status: 500 });
    }
}
