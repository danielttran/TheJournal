import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const SORT_MODES = [
    'manual', 'title-asc', 'title-desc',
    'created-newest', 'created-oldest',
    'modified-newest', 'modified-oldest',
] as const;

const UpdateCategorySchema = z.object({
    name: z.string().min(1).max(200).optional(),
    icon: z.string().max(64).nullable().optional(),
    color: z.string().regex(/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Invalid color format').optional(),
    sortMode: z.enum(SORT_MODES).optional(),
    autoTemplateId: z.number().int().min(0).nullable().optional(),
    entryFrequency: z.enum(['daily', 'weekly', 'hourly']).optional(),
    smartbookQuery: z.union([z.string().max(4000), z.record(z.string(), z.unknown())]).nullable().optional(),
    viewSettings: z.record(z.string(), z.unknown()).optional(),
    lastSelectedEntryId: z.number().int().nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const categoryId = parseInt(id, 10);

        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        const category = await db.prepare('SELECT * FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);

        if (!category) {
            return NextResponse.json({ error: "Category not found" }, { status: 404 });
        }

        return NextResponse.json(category);
    } catch (error) {
        console.error("Get category error", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}


export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const categoryId = parseInt(id, 10);

        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        // Verify ownership
        const category = await db.prepare('SELECT Name FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId) as { Name: string } | undefined;
        if (!category) {
            return NextResponse.json({ error: "Category not found or unauthorized" }, { status: 404 });
        }

        // Count entries that will be destroyed (for client-side confirmation)
        const entryCount = await db.prepare('SELECT COUNT(*) as count FROM Entry WHERE CategoryID = ?').get(categoryId) as { count: number } | undefined;
        const count = entryCount?.count || 0;

        // Check if client confirmed deletion with entry count (prevents accidental cascade)
        const url = new URL(req.url);
        const confirmed = url.searchParams.get('confirmed');
        if (count > 0 && confirmed !== 'true') {
            return NextResponse.json({
                error: "confirmation_required",
                message: `This will permanently delete "${category.Name}" and ${count} entries. This cannot be undone.`,
                entryCount: count
            }, { status: 409 });
        }

        // CASCADE DELETE: Category → Entry → EntryContent (via foreign keys)
        const result = await db.prepare('DELETE FROM Category WHERE CategoryID = ? AND UserID = ?').run(categoryId, userId);

        if (result.changes === 0) {
            return NextResponse.json({ error: "Delete failed" }, { status: 500 });
        }

        console.log(`[AUDIT] User ${userId} deleted category "${category.Name}" (ID: ${categoryId}) with ${count} entries`);
        return NextResponse.json({ success: true, deletedEntries: count });
    } catch (error) {
        console.error("Delete category error", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const categoryId = parseInt(id, 10);

        // Auth check FIRST — before any DB access
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        const rawBody = await req.json();
        const parsed = UpdateCategorySchema.safeParse(rawBody);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
        }
        const { name, icon, color, viewSettings, lastSelectedEntryId,
            sortMode, autoTemplateId, entryFrequency, smartbookQuery } = parsed.data;

        // Construct dynamic update
        const simpleUpdates: string[] = [];
        const simpleValues: (string | number | null)[] = [];

        if (name !== undefined) { simpleUpdates.push("Name = ?"); simpleValues.push(name); }
        if (icon !== undefined) { simpleUpdates.push("Icon = ?"); simpleValues.push(icon ?? null); }
        if (color !== undefined) { simpleUpdates.push("Color = ?"); simpleValues.push(color); }
        if (sortMode !== undefined) { simpleUpdates.push("SortMode = ?"); simpleValues.push(sortMode); }
        if (autoTemplateId !== undefined) {
            simpleUpdates.push("AutoTemplateID = ?");
            simpleValues.push(autoTemplateId ?? 0);
        }
        if (entryFrequency !== undefined) {
            simpleUpdates.push("EntryFrequency = ?"); simpleValues.push(entryFrequency);
        }
        if (smartbookQuery !== undefined) {
            simpleUpdates.push("SmartbookQuery = ?");
            simpleValues.push(
                smartbookQuery === null ? null
                    : typeof smartbookQuery === 'string' ? smartbookQuery
                        : JSON.stringify(smartbookQuery)
            );
        }

        const needsViewSettingsMerge = viewSettings !== undefined || lastSelectedEntryId !== undefined;

        if (simpleUpdates.length === 0 && !needsViewSettingsMerge) {
            return NextResponse.json({ success: true }); // Nothing to update
        }

        // ViewSettings read-modify-write MUST be atomic to prevent concurrent
        // requests clobbering each other's changes (e.g. month expand + entry select).
        const updateCategory = db.transaction(async () => {
            const updates: string[] = [...simpleUpdates];
            const values: (string | number | null)[] = [...simpleValues];

            if (needsViewSettingsMerge) {
                // Re-read inside the transaction so concurrent writes don't clobber each other
                const category = await db.prepare(
                    'SELECT ViewSettings FROM Category WHERE CategoryID = ? AND UserID = ?'
                ).get(categoryId, userId) as { ViewSettings: string | null } | undefined;

                if (!category) return null; // ownership check — return null signals 404

                let currentSettings: Record<string, unknown> = {};
                if (category.ViewSettings) {
                    try { currentSettings = JSON.parse(category.ViewSettings); } catch { /* corrupt JSON — start fresh */ }
                }

                if (viewSettings !== undefined) Object.assign(currentSettings, viewSettings);
                if (lastSelectedEntryId !== undefined) currentSettings.lastSelectedEntryId = lastSelectedEntryId;

                updates.push("ViewSettings = ?");
                values.push(JSON.stringify(currentSettings));
            }

            values.push(categoryId, userId);
            const result = await db.prepare(
                `UPDATE Category SET ${updates.join(", ")} WHERE CategoryID = ? AND UserID = ?`
            ).run(...values);

            return result;
        });

        const result = await updateCategory();

        if (result === null) {
            return NextResponse.json({ error: "Category not found" }, { status: 404 });
        }
        if (result.changes === 0) {
            return NextResponse.json({ error: "Category not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Update category error", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
