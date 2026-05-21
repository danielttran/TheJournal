import { join } from 'path';
import { existsSync } from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/route-helpers';

export async function GET(req: NextRequest) {
    try {
        const userId = getUserIdFromRequest(req);
        if (!userId) {
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
        const liveCount = await db.prepare("SELECT count(*) as c FROM Category").get() as { c: number };
        if (liveCount.c === 0) {
            return NextResponse.json({ error: "Export Aborted: The current database is empty." }, { status: 400 });
        }

        // 3. Flush WAL into the main DB file so the exported snapshot is
        //    complete. Without this the .tjdb file can be missing the last
        //    committed transactions that still live in the -wal sidecar.
        try {
            await db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
        } catch (e) {
            console.warn('[Export API] wal_checkpoint failed:', e);
        }

        // 4. Read the encrypted DB file
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
    } catch (error: unknown) {
        console.error("Export failed", error);
        const body: { error: string; detail?: string } = { error: "Failed to export database" };
        if (process.env.NODE_ENV !== 'production') {
            body.detail = error instanceof Error ? error.message : String(error);
        }
        return NextResponse.json(body, { status: 500 });
    }
}
