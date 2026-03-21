import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const categoryId = parseInt(id, 10);

        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        const category = db.prepare('SELECT * FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId);

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
        const category = db.prepare('SELECT Name FROM Category WHERE CategoryID = ? AND UserID = ?').get(categoryId, userId) as any;
        if (!category) {
            return NextResponse.json({ error: "Category not found or unauthorized" }, { status: 404 });
        }

        // Count entries that will be destroyed (for client-side confirmation)
        const entryCount = db.prepare('SELECT COUNT(*) as count FROM Entry WHERE CategoryID = ?').get(categoryId) as any;
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
        const result = db.prepare('DELETE FROM Category WHERE CategoryID = ? AND UserID = ?').run(categoryId, userId);

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
        const body = await req.json();
        const { name, icon, viewSettings, lastSelectedEntryId } = body;

        // Construct dynamic update
        const updates: string[] = [];
        const values: (string | number)[] = [];

        if (name !== undefined) { updates.push("Name = ?"); values.push(name); }
        if (icon !== undefined) { updates.push("Icon = ?"); values.push(icon); }

        // Handle viewSettings or lastSelectedEntryId
        if (viewSettings !== undefined || lastSelectedEntryId !== undefined) {
            // Fetch current settings
            const category = db.prepare('SELECT ViewSettings FROM Category WHERE CategoryID = ?').get(categoryId) as any;
            const currentSettings = category?.ViewSettings ? JSON.parse(category.ViewSettings) : {};

            // Merge updates
            if (viewSettings !== undefined) {
                Object.assign(currentSettings, viewSettings);
            }
            if (lastSelectedEntryId !== undefined) {
                currentSettings.lastSelectedEntryId = lastSelectedEntryId;
            }

            updates.push("ViewSettings = ?");
            values.push(JSON.stringify(currentSettings));
        }

        if (updates.length === 0) return NextResponse.json({ success: true }); // Nothing to update

        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get("userId");
        if (!userIdCookie) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = parseInt(userIdCookie.value, 10);

        values.push(categoryId, userId);

        const result = db.prepare(`UPDATE Category SET ${updates.join(", ")} WHERE CategoryID = ? AND UserID = ?`)
            .run(...values);

        if (result.changes === 0) {
            return NextResponse.json({ error: "Category not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Update category error", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
