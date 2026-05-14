import { listJournalsInDirectory, isJournalLikelyOpen } from "@/lib/journals";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";

export const dynamic = 'force-dynamic';

/**
 * GET /api/journals?dir=/some/path — directory listing for the "Open another
 * journal…" picker. When `dir` is omitted, defaults to the user's documents
 * folder. Each entry has a `likelyOpen` flag derived from the WAL/SHM size
 * probe so the UI can warn before re-opening a live database.
 *
 * Note: this exposes filesystem metadata of a directory the user nominates.
 * The userId check still applies so an unauthenticated client cannot probe.
 */
export const GET = authedHandler<[NextRequest]>('GET /api/journals', async (_userId, req) => {
    const { searchParams } = new URL(req.url);
    const requested = searchParams.get('dir');
    // Default to the user's Documents-like folder.
    const dir = requested && requested.trim().length > 0
        ? requested
        : path.join(os.homedir(), 'Documents');

    const items = await listJournalsInDirectory(dir);
    const annotated = await Promise.all(items.map(async j => ({
        ...j,
        likelyOpen: await isJournalLikelyOpen(j.path),
    })));
    return NextResponse.json({ dir, items: annotated });
});
