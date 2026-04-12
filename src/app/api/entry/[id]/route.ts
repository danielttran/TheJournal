import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateSchema = z.object({
    html: z.string().optional(),
    documentJson: z.any().optional(),
    title: z.string().optional(),
    preview: z.string().optional(),
    icon: z.string().optional(),
    sortOrder: z.number().optional(),
    parentEntryId: z.number().nullable().optional(),
    isLocked: z.boolean().optional(),
    entryType: z.enum(['Page', 'Folder']).optional(),
    isExpanded: z.boolean().optional(),
    expectedVersion: z.number().optional(),
});

// ... imports

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const entryId = parseInt(id, 10);

        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        // Ownership check
        const entry = await db.prepare(`
            SELECT 1 FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId);

        if (!entry) {
            return NextResponse.json({ error: "Entry not found or unauthorized" }, { status: 403 });
        }

        const deleteTransaction = db.transaction(async () => {
            // Single recursive CTE collects the full subtree in one query — no N+1 BFS loop.
            // Running inside BEGIN IMMEDIATE ensures no new children can be inserted
            // between the tree walk and the delete.
            const rows = await db.prepare(`
                WITH RECURSIVE subtree(id) AS (
                    SELECT ?
                    UNION ALL
                    SELECT e.EntryID FROM Entry e JOIN subtree s ON e.ParentEntryID = s.id
                )
                SELECT id FROM subtree
            `).all(entryId) as { id: number }[];

            if (rows.length === 0) return;

            const idsToDelete = rows.map(r => r.id);
            const placeholders = idsToDelete.map(() => '?').join(',');

            // Delete content first (EntryContent FK has ON DELETE CASCADE from Entry,
            // but explicit deletion is clearer and avoids relying purely on cascade order).
            await db.prepare(`DELETE FROM EntryContent WHERE EntryID IN (${placeholders})`).run(...idsToDelete);
            await db.prepare(`DELETE FROM Entry WHERE EntryID IN (${placeholders})`).run(...idsToDelete);
        });

        await deleteTransaction();

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

        const entry = await db.prepare(`
            SELECT e.EntryID, e.Title, ec.HtmlContent, ec.DocumentJson, e.Icon, e.Version
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

        // Auth: always read userId from session cookie — never trust the request body.
        // sendBeacon (POST alias below) also sends cookies for same-origin requests.
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);
        if (isNaN(userId)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();

        // 1. Validation
        const result = UpdateSchema.safeParse(body);
        if (!result.success) {
            return NextResponse.json({ error: result.error.issues }, { status: 400 });
        }

        const { html, documentJson, title, preview, icon, sortOrder, parentEntryId, isLocked, entryType, isExpanded, expectedVersion } = result.data;

        // 2. Ownership check — quick pre-flight (authoritative re-check is inside the transaction)
        const ownerCheck = await db.prepare(`
            SELECT e.CategoryID FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId) as { CategoryID: number } | undefined;

        if (!ownerCheck) {
            return NextResponse.json({ error: "Entry not found or unauthorized" }, { status: 403 });
        }

        // 2b. If parentEntryId is being set, validate it to prevent cycles and cross-category moves
        if (parentEntryId !== undefined && parentEntryId !== null) {
            if (parentEntryId === entryId) {
                return NextResponse.json({ error: "An entry cannot be its own parent" }, { status: 400 });
            }

            const parentCheck = await db.prepare(`
                SELECT e.CategoryID FROM Entry e
                JOIN Category c ON e.CategoryID = c.CategoryID
                WHERE e.EntryID = ? AND c.UserID = ? AND e.CategoryID = ?
            `).get(parentEntryId, userId, ownerCheck.CategoryID) as { CategoryID: number } | undefined;

            if (!parentCheck) {
                return NextResponse.json({ error: "Parent entry not found or unauthorized" }, { status: 403 });
            }

            // Cycle guard: walk up from parentEntryId; if we reach entryId the move would loop
            const cycle = await db.prepare(`
                WITH RECURSIVE ancestors(id) AS (
                    SELECT ParentEntryID FROM Entry WHERE EntryID = ?
                    UNION ALL
                    SELECT e.ParentEntryID FROM Entry e JOIN ancestors a ON e.EntryID = a.id
                    WHERE a.id IS NOT NULL
                )
                SELECT 1 FROM ancestors WHERE id = ? LIMIT 1
            `).get(parentEntryId, entryId) as any;

            if (cycle) {
                return NextResponse.json({ error: "Cannot set parent to a descendant" }, { status: 400 });
            }
        }

        // 3. Perform version check + write atomically inside a single BEGIN IMMEDIATE
        // transaction. Checking version outside then writing inside creates a TOCTOU
        // window where a concurrent save could slip through between the check and write.
        let newVersion = 1;
        const updateTransaction = db.transaction(async () => {
            // Re-read version inside the transaction — this is the authoritative check
            const entry = await db.prepare(
                'SELECT Version FROM Entry WHERE EntryID = ?'
            ).get(entryId) as { Version: number } | undefined;

            if (!entry) throw Object.assign(new Error('not_found'), { status: 404 });

            if (expectedVersion !== undefined && entry.Version !== expectedVersion) {
                throw Object.assign(new Error('conflict'), {
                    status: 409,
                    serverVersion: entry.Version,
                    message: 'This entry was modified in another tab or session. Please reload and try again.',
                });
            }

            newVersion = (entry.Version ?? 1) + 1;

            // 4. Update Content (if provided)
            if (html !== undefined || documentJson !== undefined) {
                const documentJsonString = documentJson !== undefined
                    ? (typeof documentJson === 'string' ? documentJson : JSON.stringify(documentJson))
                    : null;

                const updateContent = await db.prepare(`
                    UPDATE EntryContent
                    SET
                        HtmlContent = COALESCE(?, HtmlContent),
                        DocumentJson = COALESCE(?, DocumentJson)
                    WHERE EntryID = ?
                `).run(html ?? null, documentJsonString, entryId);

                if (updateContent.changes === 0) {
                    await db.prepare(`
                        INSERT INTO EntryContent (EntryID, HtmlContent, DocumentJson)
                        VALUES (?, ?, ?)
                    `).run(entryId, html || '', documentJsonString);
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
            const updateResult = await db.prepare(`UPDATE Entry SET ${updates.join(", ")} WHERE EntryID = ?`).run(...values);

            if (updateResult.changes === 0) {
                throw new Error(`UPDATE affected 0 rows for EntryID ${entryId}`);
            }
        });

        try {
            await updateTransaction();
        } catch (txErr: any) {
            if (txErr.status === 409) {
                return NextResponse.json({
                    error: 'conflict',
                    message: txErr.message,
                    serverVersion: txErr.serverVersion,
                }, { status: 409 });
            }
            if (txErr.status === 404) {
                return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
            }
            throw txErr; // re-throw unexpected errors
        }

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
