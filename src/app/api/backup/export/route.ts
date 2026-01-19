import { join } from 'path';
import { readFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
    try {
        // Force Checkpoint to ensure all WAL data is written to the main DB file
        db.pragma('wal_checkpoint(TRUNCATE)');

        const dbPath = join(process.cwd(), 'journal.db');
        const fileBuffer = await readFile(dbPath);

        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `journal-backup-${timestamp}.db`;

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': 'application/x-sqlite3',
                'Content-Disposition': `attachment; filename="${filename}"`
            }
        });
    } catch (error) {
        console.error("Export failed", error);
        return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
    }
}
