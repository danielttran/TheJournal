import { dbManager } from '@/lib/db';
import {
    setCategoryPassword,
    verifyAndUnwrap,
    clearCategoryPassword,
    rotateCategoryPassword,
    isCategoryLocked,
} from '@/lib/categoryCrypto';
import {
    cacheCategoryKey,
    clearCategoryKey,
} from '@/lib/categoryKeyCache';
import { authedHandler } from '@/lib/route-helpers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const PasswordSchema = z.object({
    password: z.string().min(1).max(256),
});

const ChangePasswordSchema = z.object({
    oldPassword: z.string().min(1).max(256),
    newPassword: z.string().min(1).max(256),
});

/**
 * GET /api/category/[id]/lock → { locked: boolean }
 *   Tells the renderer whether the category is password-protected.
 */
export const GET = authedHandler<[NextRequest, Params]>(
    'GET /api/category/[id]/lock',
    async (userId, _req, { params }) => {
        const { id } = await params;
        const categoryId = parseInt(id, 10);
        if (!Number.isFinite(categoryId)) {
            return NextResponse.json({ error: 'invalid category id' }, { status: 400 });
        }
        const locked = await isCategoryLocked(dbManager, userId, categoryId);
        return NextResponse.json({ locked });
    }
);

/**
 * POST /api/category/[id]/lock
 *   Sets a NEW password on a category that doesn't have one yet, OR
 *   unlocks an existing locked category. Switch behaviour is keyed off
 *   whether the category currently has a PasswordHash.
 *
 *   Body forms:
 *     { password }                    — set OR unlock (auto-detected)
 *     { oldPassword, newPassword }    — rotate
 */
export const POST = authedHandler<[NextRequest, Params]>(
    'POST /api/category/[id]/lock',
    async (userId, req, { params }) => {
        const { id } = await params;
        const categoryId = parseInt(id, 10);
        if (!Number.isFinite(categoryId)) {
            return NextResponse.json({ error: 'invalid category id' }, { status: 400 });
        }

        const body = await req.json().catch(() => ({}));

        // Rotate?
        if (body && typeof body === 'object' && 'oldPassword' in body && 'newPassword' in body) {
            const parsed = ChangePasswordSchema.safeParse(body);
            if (!parsed.success) {
                return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
            }
            // Atomic clear+set inside the lib helper — the category never
            // briefly appears unlocked to a concurrent request.
            const keys = await rotateCategoryPassword(
                dbManager, userId, categoryId, parsed.data.oldPassword, parsed.data.newPassword,
            );
            if (!keys) return NextResponse.json({ error: 'wrong password' }, { status: 403 });

            // Cache the new EEK BEFORE re-encrypting so concurrent reads land
            // on the up-to-date key as soon as the row's PasswordHash flipped.
            cacheCategoryKey(userId, categoryId, keys.newEek);
            // Re-encrypt all existing ciphertext from oldEek → newEek.
            await reEncryptCategoryEntries(userId, categoryId, keys.oldEek, keys.newEek);
            return NextResponse.json({ rotated: true });
        }

        const parsed = PasswordSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

        const alreadyLocked = await isCategoryLocked(dbManager, userId, categoryId);
        if (!alreadyLocked) {
            const eek = await setCategoryPassword(dbManager, userId, categoryId, parsed.data.password);
            // First-time lock: encrypt every existing entry's content so
            // a database thief sees only ciphertext. Done OUTSIDE a
            // transaction to keep memory bounded for large categories.
            await encryptAllInCategory(userId, categoryId, eek);
            cacheCategoryKey(userId, categoryId, eek);
            return NextResponse.json({ set: true });
        }

        const eek = await verifyAndUnwrap(dbManager, userId, categoryId, parsed.data.password);
        if (!eek) return NextResponse.json({ error: 'wrong password' }, { status: 403 });
        cacheCategoryKey(userId, categoryId, eek);
        return NextResponse.json({ unlocked: true });
    }
);

/**
 * DELETE /api/category/[id]/lock — clear the password (requires verifying it).
 * Body: { password }. The renderer should decrypt + re-save entries before
 * calling this if it wants the entries to remain readable later.
 */
export const DELETE = authedHandler<[NextRequest, Params]>(
    'DELETE /api/category/[id]/lock',
    async (userId, req, { params }) => {
        const { id } = await params;
        const categoryId = parseInt(id, 10);
        if (!Number.isFinite(categoryId)) {
            return NextResponse.json({ error: 'invalid category id' }, { status: 400 });
        }
        const body = await req.json().catch(() => ({}));
        const parsed = PasswordSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

        // Decrypt entries before clearing so they remain readable.
        const eek = await verifyAndUnwrap(dbManager, userId, categoryId, parsed.data.password);
        if (!eek) return NextResponse.json({ error: 'wrong password' }, { status: 403 });
        await decryptAllInCategory(userId, categoryId, eek);

        const ok = await clearCategoryPassword(dbManager, userId, categoryId, parsed.data.password);
        if (!ok) return NextResponse.json({ error: 'wrong password' }, { status: 403 });
        clearCategoryKey(userId, categoryId);
        return NextResponse.json({ cleared: true });
    }
);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function reEncryptCategoryEntries(
    userId: number,
    categoryId: number,
    oldEek: Uint8Array,
    newEek: Uint8Array,
) {
    const { decryptWithKey, encryptWithKey, ENC_PREFIX } = await import('@/lib/categoryCrypto');
    const rows = await dbManager.prepare(`
        SELECT ec.EntryID, ec.HtmlContent, ec.DocumentJson
        FROM EntryContent ec
        JOIN Entry e ON ec.EntryID = e.EntryID
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE e.CategoryID = ? AND c.UserID = ?
    `).all(categoryId, userId) as { EntryID: number; HtmlContent: string | null; DocumentJson: string | null }[];

    for (const row of rows) {
        let html = row.HtmlContent ?? '';
        let json = row.DocumentJson ?? '';
        let touched = false;
        if (html.startsWith(ENC_PREFIX)) {
            html = encryptWithKey(decryptWithKey(html, oldEek), newEek);
            touched = true;
        }
        if (json.startsWith(ENC_PREFIX)) {
            json = encryptWithKey(decryptWithKey(json, oldEek), newEek);
            touched = true;
        }
        if (touched) {
            await dbManager.prepare(
                'UPDATE EntryContent SET HtmlContent = ?, DocumentJson = ? WHERE EntryID = ?'
            ).run(html, json, row.EntryID);
        }
    }
}

async function encryptAllInCategory(userId: number, categoryId: number, eek: Uint8Array) {
    const { encryptWithKey, ENC_PREFIX } = await import('@/lib/categoryCrypto');
    const rows = await dbManager.prepare(`
        SELECT ec.EntryID, ec.HtmlContent, ec.DocumentJson
        FROM EntryContent ec
        JOIN Entry e ON ec.EntryID = e.EntryID
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE e.CategoryID = ? AND c.UserID = ?
    `).all(categoryId, userId) as { EntryID: number; HtmlContent: string | null; DocumentJson: string | null }[];

    for (const row of rows) {
        let html = row.HtmlContent ?? '';
        let json = row.DocumentJson ?? '';
        let touched = false;
        if (html && !html.startsWith(ENC_PREFIX)) { html = encryptWithKey(html, eek); touched = true; }
        if (json && !json.startsWith(ENC_PREFIX)) { json = encryptWithKey(json, eek); touched = true; }
        if (touched) {
            await dbManager.prepare(
                'UPDATE EntryContent SET HtmlContent = ?, DocumentJson = ? WHERE EntryID = ?'
            ).run(html, json, row.EntryID);
        }
    }
}

async function decryptAllInCategory(userId: number, categoryId: number, eek: Uint8Array) {
    const { decryptWithKey, ENC_PREFIX } = await import('@/lib/categoryCrypto');
    const rows = await dbManager.prepare(`
        SELECT ec.EntryID, ec.HtmlContent, ec.DocumentJson
        FROM EntryContent ec
        JOIN Entry e ON ec.EntryID = e.EntryID
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE e.CategoryID = ? AND c.UserID = ?
    `).all(categoryId, userId) as { EntryID: number; HtmlContent: string | null; DocumentJson: string | null }[];

    for (const row of rows) {
        let html = row.HtmlContent ?? '';
        let json = row.DocumentJson ?? '';
        let touched = false;
        if (html.startsWith(ENC_PREFIX)) { html = decryptWithKey(html, eek); touched = true; }
        if (json.startsWith(ENC_PREFIX)) { json = decryptWithKey(json, eek); touched = true; }
        if (touched) {
            await dbManager.prepare(
                'UPDATE EntryContent SET HtmlContent = ?, DocumentJson = ? WHERE EntryID = ?'
            ).run(html, json, row.EntryID);
        }
    }
}
