import { dbManager } from '@/lib/db';
import {
    setCategoryPassword,
    verifyAndUnwrap,
    rotateCategoryPassword,
    isCategoryLocked,
    transformCategoryEntries,
    clearCategoryPasswordFields,
    encryptWithKey,
    decryptWithKey,
    ENC_PREFIX,
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

// Three transforms, three helpers — but they all share transformCategoryEntries
// so the SELECT-and-UPDATE machinery lives in one place. Each transform
// returns the input unchanged when there's nothing to do for that row, which
// transformCategoryEntries treats as "skip the UPDATE".
const encryptIfPlaintext = (eek: Uint8Array) => (current: string) =>
    current && !current.startsWith(ENC_PREFIX) ? encryptWithKey(current, eek) : current;

const decryptIfCiphertext = (eek: Uint8Array) => (current: string) =>
    current.startsWith(ENC_PREFIX) ? decryptWithKey(current, eek) : current;

const rewrapIfCiphertext = (oldEek: Uint8Array, newEek: Uint8Array) => (current: string) =>
    current.startsWith(ENC_PREFIX)
        ? encryptWithKey(decryptWithKey(current, oldEek), newEek)
        : current;

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
            try {
                await transformCategoryEntries(
                    dbManager, userId, categoryId, rewrapIfCiphertext(keys.oldEek, keys.newEek),
                );
            } catch (err) {
                console.error('[lock route] re-encrypt failed during rotate:', err);
                return NextResponse.json({
                    error: 'Rotation partially failed — at least one entry could not be re-encrypted. The new password works for new writes; old entries may still need manual fixup.',
                }, { status: 500 });
            }
            return NextResponse.json({ rotated: true });
        }

        const parsed = PasswordSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

        const alreadyLocked = await isCategoryLocked(dbManager, userId, categoryId);
        if (!alreadyLocked) {
            const eek = await setCategoryPassword(dbManager, userId, categoryId, parsed.data.password);
            // First-time lock: encrypt every existing entry's content so a
            // database thief sees only ciphertext. transformCategoryEntries
            // is atomic; if any encryption fails, no rows are encrypted but
            // the password is already set (verified above). Surface the
            // failure to the client rather than leaving the user in a
            // half-locked state.
            try {
                await transformCategoryEntries(
                    dbManager, userId, categoryId, encryptIfPlaintext(eek),
                    // Scrub the plaintext PreviewText of every existing entry in the
                    // same transaction. It holds the first ~200 chars of the body and
                    // is NOT decryption-gated on read, so leaving it would leak locked
                    // content in the sidebar/list/on-this-day surfaces.
                    () => dbManager.prepare(
                        `UPDATE Entry SET PreviewText = '' WHERE CategoryID = ?`
                    ).run(categoryId).then(() => undefined),
                );
            } catch (err) {
                console.error('[lock route] encrypt-all failed during initial lock:', err);
                return NextResponse.json({
                    error: 'Could not encrypt every existing entry. The password was set, but reload and verify your data before adding new content.',
                }, { status: 500 });
            }
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
 * Body: { password }. Entries are decrypted back to plaintext before the
 * password fields are cleared, so they remain readable after the lock is
 * removed.
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

        const eek = await verifyAndUnwrap(dbManager, userId, categoryId, parsed.data.password);
        if (!eek) return NextResponse.json({ error: 'wrong password' }, { status: 403 });
        // transformCategoryEntries is atomic — if any row's ciphertext is
        // corrupt and decryption throws, the whole transaction rolls back
        // and we refuse to clear the password. Without the rollback the
        // user would end up with a category that has no password but still
        // contains undecryptable ENC1: rows → permanent data loss.
        // Decrypt every entry AND clear the password fields in ONE transaction
        // (afterTransform). Doing the clear in the same tx closes the window where
        // a concurrent save could re-encrypt an entry between the decrypt commit
        // and the password clear, leaving an undecryptable ENC1: row.
        try {
            await transformCategoryEntries(
                dbManager, userId, categoryId, decryptIfCiphertext(eek),
                () => clearCategoryPasswordFields(dbManager, userId, categoryId),
            );
        } catch (err) {
            console.error('[lock route] decrypt-all failed during clear-password:', err);
            return NextResponse.json({
                error: 'Could not decrypt every entry in this category. Password NOT removed. Inspect the failing entries before retrying.',
            }, { status: 500 });
        }

        clearCategoryKey(userId, categoryId);
        return NextResponse.json({ cleared: true });
    }
);
