import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = 'force-dynamic';

// ─── Keyset Cursor Helpers ────────────────────────────────────────────────────
// Cursor encodes the last item's (CreatedDate, EntryID) as a base64 string so
// the client can pass it opaquely as ?cursor=<value> for the next page.
// This avoids OFFSET which degrades to O(N) table scans at large page numbers.

interface CursorPayload { createdDate: string; entryId: number; }

function encodeCursor(createdDate: string, entryId: number): string {
    return Buffer.from(JSON.stringify({ createdDate, entryId })).toString('base64url');
}

function decodeCursor(raw: string): CursorPayload | null {
    try {
        const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        if (typeof parsed.createdDate === 'string' && typeof parsed.entryId === 'number') {
            return parsed as CursorPayload;
        }
        return null;
    } catch {
        return null;
    }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get('categoryId');

    if (!categoryId) {
        return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
    }

    try {
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        // Verify category ownership
        const category = await db.prepare('SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);
        if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });

        // ── Journal mode: keyset-paginated timeline (infinite scroll) ──────────
        // Use ?mode=journal&limit=<n>&cursor=<opaque> to activate.
        // Without mode=journal we fall through to the full sidebar tree fetch.
        const mode = searchParams.get('mode');
        if (mode === 'journal') {
            const parsedLimit = parseInt(searchParams.get('limit') || '20', 10);
            const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;
            const cursorRaw = searchParams.get('cursor') || null;

            let entries: object[];

            if (cursorRaw) {
                const cursor = decodeCursor(cursorRaw);
                if (!cursor) {
                    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
                }
                // Keyset predicate: entries that come strictly before the cursor position
                // when sorted by (CreatedDate DESC, EntryID DESC).
                entries = await db.prepare(`
                    SELECT EntryID, Title, CreatedDate, ModifiedDate, PreviewText,
                           IsLocked, IsFavorited, Mood, Tags, EntryType
                    FROM Entry
                    WHERE CategoryID = ?
                      AND EntryType = 'Page'
                      AND (
                          CreatedDate < ?
                          OR (CreatedDate = ? AND EntryID < ?)
                      )
                    ORDER BY CreatedDate DESC, EntryID DESC
                    LIMIT ?
                `).all(categoryId, cursor.createdDate, cursor.createdDate, cursor.entryId, limit);
            } else {
                // First page — no cursor constraint
                entries = await db.prepare(`
                    SELECT EntryID, Title, CreatedDate, ModifiedDate, PreviewText,
                           IsLocked, IsFavorited, Mood, Tags, EntryType
                    FROM Entry
                    WHERE CategoryID = ?
                      AND EntryType = 'Page'
                    ORDER BY CreatedDate DESC, EntryID DESC
                    LIMIT ?
                `).all(categoryId, limit);
            }

            // Build the next cursor from the last item in the page
            let nextCursor: string | null = null;
            if (entries.length === limit) {
                const last = entries[entries.length - 1] as { CreatedDate: string; EntryID: number };
                nextCursor = encodeCursor(last.CreatedDate, last.EntryID);
            }

            return NextResponse.json({ entries, nextCursor });
        }

        // ── Default mode: full tree fetch for sidebar ──────────────────────────
        const entries = await db.prepare(`
            SELECT EntryID, Title, ParentEntryID, EntryType, SortOrder, Icon, IsExpanded, IsLocked,
                   IsFavorited, Mood, Tags, PreviewText
            FROM Entry
            WHERE CategoryID = ?
            ORDER BY SortOrder ASC
        `).all(categoryId);
        return NextResponse.json(entries);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 });
    }
}
