import { join } from 'path';
import { readFile, unlink, stat } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import Database from 'better-sqlite3';

export async function GET() {
    try {
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        console.log("Export: Starting SQLite Backup...");

        // 1. Validate Live DB has data
        const liveCount = db.prepare("SELECT Count(*) as c FROM Category").get() as any;
        if (liveCount.c === 0) {
            throw new Error("Export Aborted: The current database is empty.");
        }

        const timestamp = new Date().toISOString().split('T')[0];
        const tempName = `backup-${Date.now()}.db`;
        const tempPath = join(process.cwd(), tempName);

        // 2. Use VACUUM INTO for atomic snapshot
        db.prepare('VACUUM INTO ?').run(tempPath);

        // 3. Verify Snapshot
        const verifyDb = new Database(tempPath);
        try {
            const verifyCount = verifyDb.prepare("SELECT Count(*) as c FROM Category").get() as any;
            if (verifyCount.c === 0) {
                await unlink(tempPath);
                throw new Error(`Export Integrity Check Failed: Snapshot has 0 categories.`);
            }
        } finally {
            verifyDb.close();
        }

        const fileBuffer = await readFile(tempPath);
        await unlink(tempPath);

        const filename = `journal-backup-${timestamp}.db`;

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': 'application/x-sqlite3',
                'Content-Disposition': `attachment; filename="${filename}"`
            }
        });
    } catch (error: any) {
        console.error("Export failed", error);
        return NextResponse.json({ error: error.message || "Failed to export database" }, { status: 500 });
    }
}
