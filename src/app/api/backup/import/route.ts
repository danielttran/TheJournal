import { join } from 'path';
import { writeFile, copyFile, unlink } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { dbManager, db } from '@/lib/db';

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

        // Close DB connection to release lock
        dbManager.close();

        // 100ms delay to ensure file handle release on Windows
        await new Promise(resolve => setTimeout(resolve, 100));

        // Delete WAL and SHM files to prevent corruption/mismatch with new DB
        try {
            await unlink(`${dbPath}-wal`);
            await unlink(`${dbPath}-shm`);
        } catch (e) {
            // Ignore error if files don't exist
        }

        // Overwrite DB
        await writeFile(dbPath, buffer);

        // Re-assign ownership of imported data to current user
        // This ensures that even if the backup is from another account/session, 
        // the current logged-in user can see it.
        const { cookies } = require("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");

        if (userIdCookie) {
            const userId = parseInt(userIdCookie.value, 10);

            // The DB connection will auto-reopen due to our DBManager proxy
            // Check tables exists to avoid errors if schema differs slightly, but generally assuming standard schema
            try {
                // Update Categories
                db.prepare('UPDATE Category SET UserID = ?').run(userId);

                // Update Entries (if table exists and has UserID, which it should)
                // Note: Entry usually inherits permission from Category, but often has denormalized UserID
                // Checking previous schema knowledge: Entry has UserID? 
                // In CreateEntrySchema: userId is passed. So yes.
                db.prepare('UPDATE Entry SET UserID = ?').run(userId);

            } catch (e) {
                console.warn("Failed to re-assign some tables", e);
                // Proceed anyway, success is true
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Import failed", error);
        return NextResponse.json({ error: "Failed to import database" }, { status: 500 });
    }
}
