import { db, dbManager } from "@/lib/db";
import { softDeleteEntry, permanentlyDeleteEntry } from "@/lib/trash";
import { normalizeTag } from "@/lib/tags";
import { isWriteToLockedEntryBlocked } from "@/lib/entryLock";
import { decryptEntryContent, maybeEncryptForCategory } from "@/lib/entryEncryption";
import { isCategoryLocked } from "@/lib/categoryCrypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/route-helpers";
import { CREATED_DATE_SHAPE, normalizeCreatedDate } from "@/lib/entryDate";

/**
 * Tags arrive as a JSON-encoded array of user-entered strings. Normalize each
 * entry (lowercase, trim, drop trailing commas) and dedupe so the same tag
 * isn't stored under two casings ("React" vs "react"). The bulk tag API
 * already does this — keeping both paths in sync prevents drift.
 */
function normalizeTagsPayload(raw: string): string {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return '[]'; }
    if (!Array.isArray(parsed)) return '[]';
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of parsed) {
        if (typeof t !== 'string') continue;
        const n = normalizeTag(t);
        if (!n || seen.has(n)) continue;
        seen.add(n);
        out.push(n);
    }
    return JSON.stringify(out);
}

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
    mood: z.string().nullable().optional(),
    isFavorited: z.boolean().optional(),
    tags: z.string().optional(),
    expectedVersion: z.number().optional(),
    // J8 "change entry date": accepts YYYY-MM-DD (noon, matching by-date's
    // timezone-safe convention) or a full YYYY-MM-DD HH:MM[:SS] timestamp.
    createdDate: z.string().regex(CREATED_DATE_SHAPE).optional(),
});

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const entryId = parseInt(id, 10);

        const userId = getUserIdFromRequest(req);
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // Ownership check
        const entry = await db.prepare(`
            SELECT 1 FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId);

        if (!entry) {
            return NextResponse.json({ error: "Entry not found or unauthorized" }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const permanent = searchParams.get('permanent') === 'true';

        if (permanent) {
            await permanentlyDeleteEntry(dbManager, entryId);
        } else {
            await softDeleteEntry(dbManager, entryId);
        }

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

        const userId = getUserIdFromRequest(req);
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const entry = await db.prepare(`
            SELECT e.EntryID, e.Title, e.CategoryID, ec.HtmlContent, ec.DocumentJson, e.Icon, e.Version,
                   e.IsFavorited, e.Mood, e.Tags, e.IsLocked
            FROM Entry e
            LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId) as {
            EntryID: number; Title: string; CategoryID: number;
            HtmlContent: string | null; DocumentJson: string | null;
            Icon: string | null; Version: number;
            IsFavorited: number | boolean; Mood: string | null; Tags: string | null;
            IsLocked: number | boolean;
        } | undefined;

        if (!entry) {
            return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        }

        // Decrypt category-locked content if the EEK is cached. When the
        // category is locked and we don't have the key, return null
        // content + categoryLocked=true so the renderer can prompt for
        // the password instead of rendering ciphertext.
        const decrypted = await decryptEntryContent(
            dbManager, userId, entry.CategoryID, entry.HtmlContent, entry.DocumentJson,
        );
        return NextResponse.json({
            ...entry,
            HtmlContent: decrypted.html,
            DocumentJson: decrypted.documentJson,
            categoryLocked: decrypted.locked,
        });
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
        const userId = getUserIdFromRequest(req);
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();

        // 1. Validation
        const result = UpdateSchema.safeParse(body);
        if (!result.success) {
            return NextResponse.json({ error: result.error.issues }, { status: 400 });
        }

        const { html, documentJson, title, preview, icon, sortOrder, parentEntryId, isLocked, entryType, isExpanded, mood, isFavorited, tags, expectedVersion, createdDate } = result.data;

        let createdDateToWrite: string | undefined;
        if (createdDate !== undefined) {
            const normalized = normalizeCreatedDate(createdDate);
            if (!normalized) {
                return NextResponse.json({ error: "Invalid date" }, { status: 400 });
            }
            createdDateToWrite = normalized;
        }

        // 2. Ownership check — quick pre-flight (authoritative re-check is inside the transaction)
        const ownerCheck = await db.prepare(`
            SELECT e.CategoryID FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId) as { CategoryID: number } | undefined;

        if (!ownerCheck) {
            return NextResponse.json({ error: "Entry not found or unauthorized" }, { status: 403 });
        }

        // 2a. Read-only-lock enforcement: a locked entry refuses content writes
        // (html/documentJson/title/preview) but still allows isLocked toggles and
        // metadata edits (mood/favorite/tags). Without this, a stale TipTap save
        // from another tab could overwrite a locked entry's content.
        if (await isWriteToLockedEntryBlocked(dbManager, entryId, result.data as Record<string, unknown>)) {
            return NextResponse.json(
                { error: "Entry is locked. Unlock from the sidebar menu to edit." },
                { status: 423 },
            );
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
            `).get(parentEntryId, entryId) as { 1: number } | undefined;

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

            // PreviewText is the first ~200 chars of the plaintext body and is NOT
            // decryption-gated on read (the sidebar/list/on-this-day/random
            // surfaces return it directly), so it must never be persisted in
            // plaintext for a password-locked category. Scrub it based on the
            // category's lock state INDEPENDENT of whether content is co-sent —
            // a preview-only PUT must be scrubbed too (blanking needs no EEK).
            let previewToWrite = preview;
            if (preview !== undefined && await isCategoryLocked(dbManager, userId, ownerCheck.CategoryID)) {
                previewToWrite = '';
            }

            // 4. Update Content (if provided)
            if (html !== undefined || documentJson !== undefined) {
                let documentJsonString: string | null = documentJson !== undefined
                    ? (typeof documentJson === 'string' ? documentJson : JSON.stringify(documentJson))
                    : null;
                let htmlToWrite: string | null = html ?? null;

                // M3.11 — if the category is password-locked, encrypt with
                // the cached EEK before persisting. A locked category with
                // no cached EEK rejects the save (the request would
                // otherwise overwrite ciphertext with plaintext).
                try {
                    const encrypted = await maybeEncryptForCategory(
                        dbManager, userId, ownerCheck.CategoryID, htmlToWrite, documentJsonString,
                    );
                    htmlToWrite = encrypted.html;
                    documentJsonString = encrypted.documentJson;
                } catch (err) {
                    if ((err as Error & { code?: string }).code === 'CATEGORY_LOCKED') {
                        throw Object.assign(new Error('category_locked'), {
                            status: 423,
                            message: 'Category is locked. Unlock it first.',
                        });
                    }
                    throw err;
                }

                const updateContent = await db.prepare(`
                    UPDATE EntryContent
                    SET
                        HtmlContent = COALESCE(?, HtmlContent),
                        DocumentJson = COALESCE(?, DocumentJson)
                    WHERE EntryID = ?
                `).run(htmlToWrite, documentJsonString, entryId);

                if (updateContent.changes === 0) {
                    // Use htmlToWrite (the encrypted value for a locked category),
                    // NOT the raw html — otherwise this fallback INSERT would store
                    // plaintext HtmlContent alongside ciphertext DocumentJson,
                    // leaking content and desyncing the two columns.
                    await db.prepare(`
                        INSERT INTO EntryContent (EntryID, HtmlContent, DocumentJson)
                        VALUES (?, ?, ?)
                    `).run(entryId, htmlToWrite ?? '', documentJsonString);
                }
            }

            // 5. Update Metadata + bump version
            const updates: string[] = ["Version = ?", "ModifiedDate = CURRENT_TIMESTAMP"];
            const values: (string | number | null)[] = [newVersion];

            if (title !== undefined) { updates.push("Title = ?"); values.push(title); }
            if (preview !== undefined) { updates.push("PreviewText = ?"); values.push(previewToWrite ?? ''); }
            if (icon !== undefined) { updates.push("Icon = ?"); values.push(icon); }
            if (sortOrder !== undefined) { updates.push("SortOrder = ?"); values.push(sortOrder); }
            if (parentEntryId !== undefined) { updates.push("ParentEntryID = ?"); values.push(parentEntryId); }
            if (isLocked !== undefined) { updates.push("IsLocked = ?"); values.push(isLocked ? 1 : 0); }
            if (entryType !== undefined) { updates.push("EntryType = ?"); values.push(entryType); }
            if (isExpanded !== undefined) { updates.push("IsExpanded = ?"); values.push(isExpanded ? 1 : 0); }
            if (mood !== undefined) { updates.push("Mood = ?"); values.push(mood ?? null); }
            if (isFavorited !== undefined) { updates.push("IsFavorited = ?"); values.push(isFavorited ? 1 : 0); }
            if (tags !== undefined) { updates.push("Tags = ?"); values.push(normalizeTagsPayload(tags)); }
            if (createdDateToWrite !== undefined) { updates.push("CreatedDate = ?"); values.push(createdDateToWrite); }

            values.push(entryId);
            const updateResult = await db.prepare(`UPDATE Entry SET ${updates.join(", ")} WHERE EntryID = ?`).run(...values);

            if (updateResult.changes === 0) {
                throw new Error(`UPDATE affected 0 rows for EntryID ${entryId}`);
            }
        });

        try {
            await updateTransaction();
        } catch (txErr) {
            const e = txErr as { status?: number; message?: string; serverVersion?: number };
            if (e.status === 409) {
                return NextResponse.json({
                    error: 'conflict',
                    message: e.message,
                    serverVersion: e.serverVersion,
                }, { status: 409 });
            }
            if (e.status === 404) {
                return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
            }
            if (e.status === 423) {
                return NextResponse.json({ error: e.message ?? 'Locked' }, { status: 423 });
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
