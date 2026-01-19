import { join } from 'path';
import { writeFile, copyFile, unlink } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const dbPath = join(process.cwd(), 'journal.db');
        const backupPath = join(process.cwd(), 'journal.db.bak');

        // Backup existing DB
        try {
            await copyFile(dbPath, backupPath);
        } catch (e) {
            console.warn("No existing DB to backup or backup failed", e);
        }

        // Overwrite DB
        await writeFile(dbPath, buffer);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Import failed", error);
        return NextResponse.json({ error: "Failed to import database" }, { status: 500 });
    }
}
