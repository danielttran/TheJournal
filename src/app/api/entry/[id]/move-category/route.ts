import { db } from "@/lib/db";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * PUT /api/entry/[id]/move-category  body: { categoryId }
 * David RM "Move Entry to Category". Reparents the entry to the root of the
 * target category (ParentEntryID cleared, since a parent must live in the same
 * category). Refuses when either the source or target category is password-
 * locked — moving across an encryption boundary would require re-keying the
 * content, which is out of scope for a plain move.
 */
export const PUT = authedHandler<[NextRequest, { params: Promise<{ id: string }> }]>(
    'PUT /api/entry/[id]/move-category',
    async (userId, req, { params }) => {
        const entryId = parseInt((await params).id, 10);
        const body = await req.json().catch(() => null) as { categoryId?: number } | null;
        const targetCategoryId = Number(body?.categoryId);
        if (!Number.isFinite(entryId) || !Number.isFinite(targetCategoryId)) {
            return NextResponse.json({ error: 'Invalid entry or category id' }, { status: 400 });
        }

        const entry = await db.prepare(`
            SELECT e.CategoryID FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            WHERE e.EntryID = ? AND c.UserID = ?
        `).get(entryId, userId) as { CategoryID: number } | undefined;
        if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });

        const target = await db.prepare(
            'SELECT CategoryID, PasswordHash FROM Category WHERE CategoryID = ? AND UserID = ?'
        ).get(targetCategoryId, userId) as { CategoryID: number; PasswordHash: string | null } | undefined;
        if (!target) return NextResponse.json({ error: 'Target category not found' }, { status: 404 });

        const source = await db.prepare(
            'SELECT PasswordHash FROM Category WHERE CategoryID = ?'
        ).get(entry.CategoryID) as { PasswordHash: string | null } | undefined;

        if (source?.PasswordHash || target.PasswordHash) {
            return NextResponse.json(
                { error: 'Cannot move entries into or out of a password-locked category.' },
                { status: 423 },
            );
        }

        await db.prepare(
            'UPDATE Entry SET CategoryID = ?, ParentEntryID = NULL WHERE EntryID = ?'
        ).run(targetCategoryId, entryId);

        return NextResponse.json({ ok: true, categoryId: targetCategoryId });
    },
);
