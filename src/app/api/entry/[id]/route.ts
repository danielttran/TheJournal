import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateSchema = z.object({
    content: z.any().optional(), // JSON object (Quill Delta) - OPTIONAL for metadata-only updates
    html: z.string().optional(),
    title: z.string().optional(),
    preview: z.string().optional(),
    userId: z.number().or(z.string().transform(val => parseInt(val, 10))),
    icon: z.string().optional(),
    sortOrder: z.number().optional(),
    parentEntryId: z.number().nullable().optional(),
    isLocked: z.boolean().optional(),
    entryType: z.enum(['Page', 'Section']).optional(),
    isExpanded: z.boolean().optional(),
    expectedVersion: z.number().optional(), // Optimistic locking
});

// ... imports

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    // Recursive helper to get all descendant IDs
    const getAllDescendantIds = (rootId: number): number[] => {
        const descendants: number[] = [];
        const queue = [rootId];
        while (queue.length > 0) {
            const current = queue.shift()!;
            descendants.push(current);
            const children = db.prepare('SELECT EntryID FROM Entry WHERE ParentEntryID = ?').all(current) as { EntryID: number }[];
            for (const child of children) {
                queue.push(child.EntryID);
            }
        }
        return descendants;
    };

    try {
        const { id } = await params;
        const entryId = parseInt(id, 10);

        // Optional: Check ownership here if we had session info easily available
        // For strictness, we should extract userId from cookie similar to other routes
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        // Security Check
        const entry = db.prepare(`
            SELECT 1 FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId);

        if (!entry) {
            return NextResponse.json({ error: "Entry not found or unauthorized" }, { status: 403 });
        }

        const deleteTransaction = db.transaction(() => {
            // 1. Identify all IDs to delete (Self + Descendants)
            const idsToDelete = getAllDescendantIds(entryId);

            if (idsToDelete.length === 0) return;

            const placeholders = idsToDelete.map(() => '?').join(',');

            // 2. Delete Content
            db.prepare(`DELETE FROM EntryContent WHERE EntryID IN (${placeholders})`).run(...idsToDelete);

            // 3. Delete Entries
            // We can delete all in one go. Foreign keys might complain if we don't do bottom-up, 
            // but with standard SQLite FKs ON, deleting parents might auto-cascade or fail. 
            // Safest: Delete all Entry rows in the set.
            // If we just DELETE FROM Entry WHERE EntryID IN (...), order matters if self-referencing FK is restrictive.
            // But usually, deleting parent with CASCADE works. If NO ACTION/RESTRICT, we must delete children first.
            // Let's assume standard behavior: delete the set. If fails, we might need reverse sort by hierarchy.
            db.prepare(`DELETE FROM Entry WHERE EntryID IN (${placeholders})`).run(...idsToDelete);
        });

        deleteTransaction();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Delete entry error", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const entryId = parseInt(id, 10);

        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        const entry = db.prepare(`
            SELECT e.EntryID, e.Title, ec.HtmlContent, ec.QuillDelta, e.Icon, e.Version
            FROM Entry e
            LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId);

        if (!entry) {
            return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        }

        return NextResponse.json(entry);
    } catch (error) {
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const entryId = parseInt(id, 10);

        const body = await req.json();

        // Debug logging for large payloads - OPTIMIZED to prevent crash
        if (body.content) {
            const contentLength = req.headers.get('content-length') || 'unknown';
            console.log(`[API] PUT Entry ${entryId} - Content update (Length: ${contentLength})`);
        } else {
            console.log(`[API] PUT Entry ${entryId} - Metadata update`);
        }

        // 1. Validation
        const result = UpdateSchema.safeParse(body);
        if (!result.success) {
            console.error(`[API] Validation failed for Entry ${entryId}:`, result.error.issues);
            return NextResponse.json({ error: result.error.issues }, { status: 400 });
        }

        const { content, html, title, preview, userId, icon, sortOrder, parentEntryId, isLocked, entryType, isExpanded, expectedVersion } = result.data;

        // 2. Security Check
        const entry = db.prepare(`
            SELECT e.Version FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId) as { Version: number } | undefined;

        if (!entry) {
            return NextResponse.json({ error: "Entry not found or unauthorized" }, { status: 403 });
        }

        // 3. Optimistic locking: if client sends expectedVersion, reject if stale
        if (expectedVersion !== undefined && entry.Version !== expectedVersion) {
            return NextResponse.json({
                error: "conflict",
                message: "This entry was modified in another tab or session. Please reload and try again.",
                serverVersion: entry.Version
            }, { status: 409 });
        }

        // Wrap in transaction
        let newVersion = (entry.Version ?? 1) + 1;
        const updateTransaction = db.transaction(() => {
            // 4. Update Content (if provided)
            if (content !== undefined) {
                const deltaString = JSON.stringify(content);
                const updateContent = db.prepare(`
                    UPDATE EntryContent
                    SET QuillDelta = ?, HtmlContent = ?
                    WHERE EntryID = ?
                `).run(deltaString, html || '', entryId);

                if (updateContent.changes === 0) {
                    db.prepare(`
                        INSERT INTO EntryContent (EntryID, QuillDelta, HtmlContent)
                        VALUES (?, ?, ?)
                    `).run(entryId, deltaString, html || '');
                }
            }

            // 5. Update Metadata + bump version
            const updates: string[] = ["Version = ?", "ModifiedDate = CURRENT_TIMESTAMP"];
            const values: (string | number | null)[] = [newVersion];

            if (title !== undefined) { updates.push("Title = ?"); values.push(title); }
            if (preview !== undefined) { updates.push("PreviewText = ?"); values.push(preview); }
            if (icon !== undefined) { updates.push("Icon = ?"); values.push(icon); }
            if (sortOrder !== undefined) { updates.push("SortOrder = ?"); values.push(sortOrder); }
            if (parentEntryId !== undefined) { updates.push("ParentEntryID = ?"); values.push(parentEntryId); }
            if (isLocked !== undefined) { updates.push("IsLocked = ?"); values.push(isLocked ? 1 : 0); }
            if (entryType !== undefined) { updates.push("EntryType = ?"); values.push(entryType); }
            if (isExpanded !== undefined) { updates.push("IsExpanded = ?"); values.push(isExpanded ? 1 : 0); }

            values.push(entryId);
            const updateResult = db.prepare(`UPDATE Entry SET ${updates.join(", ")} WHERE EntryID = ?`).run(...values);

            if (updateResult.changes === 0) {
                throw new Error(`UPDATE affected 0 rows for EntryID ${entryId}`);
            }
        });

        updateTransaction();

        return NextResponse.json({ success: true, version: newVersion });

    } catch (error) {
        console.error("PUT /api/entry/[id] error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// Alias POST to PUT for sendBeacon support
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return PUT(req, { params });
}
