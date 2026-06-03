import { dbManager } from "@/lib/db";
import { encryptEntry, decryptEntry, type EncryptedBlob } from "@/lib/entryCrypto";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * Per-entry encryption — David RM "Lock this entry". Stores the encrypted
 * blob in EntryContent.HtmlContent (as JSON-stringified blob) and sets
 * Entry.IsLocked=1. Wipes plaintext from EntryContent + FTS so the password
 * is the ONLY way back.
 *
 *   POST   /api/entry/:id/lock       body: { password: string }
 *   PUT    /api/entry/:id/lock       body: { password: string }  → returns plaintext (one-shot reveal)
 *   DELETE /api/entry/:id/lock       body: { password: string }  → permanently unlock + restore plaintext
 */

async function ownedEntry(userId: number, entryId: number) {
    // Ownership is enforced in SQL (AND c.UserID = ?) per the codebase
    // invariant — every query filters by UserID — not just by a post-query
    // JS check, so a future caller can't accidentally skip it.
    return await dbManager.prepare(`
        SELECT e.EntryID, e.IsLocked, ec.HtmlContent, c.UserID
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE e.EntryID = ? AND c.UserID = ? AND e.IsDeleted = 0
    `).get(entryId, userId) as { EntryID: number; IsLocked: number; HtmlContent: string | null; UserID: number } | undefined;
}

function isBlob(x: unknown): x is EncryptedBlob {
    if (typeof x !== 'object' || x === null) return false;
    const o = x as Record<string, unknown>;
    return typeof o.version === 'number'
        && typeof o.salt === 'string'
        && typeof o.iv === 'string'
        && typeof o.ciphertext === 'string';
}

export const POST = authedHandler<[NextRequest, { params: Promise<{ id: string }> }]>(
    'POST /api/entry/[id]/lock',
    async (userId, req, { params }) => {
        const { id } = await params;
        const entryId = parseInt(id, 10);
        if (!Number.isFinite(entryId)) {
            return NextResponse.json({ error: 'Invalid entry id' }, { status: 400 });
        }
        const body = await req.json().catch(() => null) as { password?: string } | null;
        const password = body?.password;
        if (!password) {
            return NextResponse.json({ error: 'password required' }, { status: 400 });
        }

        const row = await ownedEntry(userId, entryId);
        if (!row || row.UserID !== userId) {
            return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
        }
        if (row.IsLocked) {
            return NextResponse.json({ error: 'Already locked' }, { status: 409 });
        }

        const blob = encryptEntry(row.HtmlContent ?? '', password);
        // Wrap in a transaction so the EntryContent UPDATE (which fires the
        // FTS sync trigger and indexes the encrypted blob) and the manual
        // FTS DELETE land atomically. Otherwise concurrent search requests
        // can briefly hit the encrypted ciphertext as an FTS row.
        const lockTx = dbManager.transaction(async () => {
            await dbManager.prepare(
                `UPDATE EntryContent SET HtmlContent = ?, DocumentJson = NULL WHERE EntryID = ?`
            ).run(JSON.stringify(blob), entryId);
            await dbManager.prepare(`UPDATE Entry SET IsLocked = 1 WHERE EntryID = ?`).run(entryId);
            await dbManager.prepare(`DELETE FROM EntrySearch WHERE rowid = ?`).run(entryId);
        });
        await lockTx();
        return NextResponse.json({ locked: true });
    },
);

export const PUT = authedHandler<[NextRequest, { params: Promise<{ id: string }> }]>(
    'PUT /api/entry/[id]/lock',
    async (userId, req, { params }) => {
        const { id } = await params;
        const entryId = parseInt(id, 10);
        const body = await req.json().catch(() => null) as { password?: string } | null;
        const password = body?.password;
        if (!Number.isFinite(entryId) || !password) {
            return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
        }
        const row = await ownedEntry(userId, entryId);
        if (!row || row.UserID !== userId || !row.IsLocked) {
            return NextResponse.json({ error: 'Entry not locked' }, { status: 404 });
        }
        let blob: EncryptedBlob;
        try { blob = JSON.parse(row.HtmlContent ?? ''); }
        catch { return NextResponse.json({ error: 'Corrupt locked entry' }, { status: 500 }); }
        if (!isBlob(blob)) {
            return NextResponse.json({ error: 'Corrupt locked entry' }, { status: 500 });
        }
        try {
            const plaintext = decryptEntry(blob, password);
            return NextResponse.json({ plaintext });
        } catch {
            return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
        }
    },
);

export const DELETE = authedHandler<[NextRequest, { params: Promise<{ id: string }> }]>(
    'DELETE /api/entry/[id]/lock',
    async (userId, req, { params }) => {
        const { id } = await params;
        const entryId = parseInt(id, 10);
        const body = await req.json().catch(() => null) as { password?: string } | null;
        const password = body?.password;
        if (!Number.isFinite(entryId) || !password) {
            return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
        }
        const row = await ownedEntry(userId, entryId);
        if (!row || row.UserID !== userId || !row.IsLocked) {
            return NextResponse.json({ error: 'Entry not locked' }, { status: 404 });
        }
        let blob: EncryptedBlob;
        try { blob = JSON.parse(row.HtmlContent ?? ''); }
        catch { return NextResponse.json({ error: 'Corrupt locked entry' }, { status: 500 }); }
        if (!isBlob(blob)) {
            return NextResponse.json({ error: 'Corrupt locked entry' }, { status: 500 });
        }
        let plaintext: string;
        try { plaintext = decryptEntry(blob, password); }
        catch { return NextResponse.json({ error: 'Wrong password' }, { status: 401 }); }

        // Same atomicity concern as POST: the UPDATE on EntryContent triggers
        // the FTS sync, and the manual INSERT OR REPLACE re-indexes — keep
        // them in one transaction so readers never observe a partial state.
        const unlockTx = dbManager.transaction(async () => {
            await dbManager.prepare(
                `UPDATE EntryContent SET HtmlContent = ? WHERE EntryID = ?`
            ).run(plaintext, entryId);
            await dbManager.prepare(`UPDATE Entry SET IsLocked = 0 WHERE EntryID = ?`).run(entryId);
            await dbManager.prepare(
                `INSERT OR REPLACE INTO EntrySearch (rowid, Title, HtmlContent)
                 SELECT e.EntryID, e.Title, ?
                 FROM Entry e WHERE e.EntryID = ?`
            ).run(plaintext, entryId);
        });
        await unlockTx();
        return NextResponse.json({ locked: false });
    },
);
