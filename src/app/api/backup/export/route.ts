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
        const dbPath = process.env.JOURNAL_DB_PATH || join(process.cwd(), 'journal.tjdb');
        if (!existsSync(dbPath)) {
            throw new Error("Database file not found.");
        }

        // 2. Validate that there is data to export
        const liveCount = await db.prepare("SELECT count(*) as c FROM Category").get() as any;
        if (liveCount.c === 0) {
            throw new Error("Export Aborted: The current database is empty.");
        }

        // 3. Copy the encrypted DB file directly.
        //    The copy IS encrypted (SQLCipher) — VACUUM INTO would have created a plain-text file.
        const timestamp = new Date().toISOString().split('T')[0];
        const tempPath = join(process.cwd(), `export-temp-${Date.now()}.tjdb`);
        await copyFile(dbPath, tempPath);

        // 4. Read and return, then clean up
        const { readFile } = await import('fs/promises');
        const fileBuffer = await readFile(tempPath);
        await unlink(tempPath);

        const filename = `journal-backup-${timestamp}.tjdb`;

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${filename}"`
            }
        });
    } catch (error: any) {
        console.error("Export failed", error);
        return NextResponse.json({ error: error.message || "Failed to export database" }, { status: 500 });
    }
}
