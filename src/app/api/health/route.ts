import { dbManager } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const PROCESS_STARTED_AT = Date.now();

/**
 * GET /api/health
 *   Public, unauthenticated. Used by:
 *     - Caddy / nginx upstream healthchecks.
 *     - Container orchestrators / uptime monitors.
 *     - Operators ("did my server come up?") via curl.
 *
 *   Returns 200 with:
 *     status:      'ok' when the DB is reachable AND unlocked.
 *                  'degraded' when the process is running but the DB
 *                  connection threw on a trivial SELECT.
 *     dbUnlocked:  whether the SQLCipher handle has been keyed (the app
 *                  unlocks lazily on first request).
 *     uptimeMs:    ms since this Node process started. Stable across
 *                  successive calls so monitors can detect restarts.
 *     version:     app version string (from package.json at build time).
 *
 *   No PII, no secrets. Safe to expose at the edge.
 *
 * @swagger
 * /api/health:
 *   get:
 *     tags:
 *       - Health
 *     description: Liveness + readiness probe.
 *     responses:
 *       200:
 *         description: Server is up. Inspect `status` and `dbUnlocked` for readiness.
 */
export async function GET() {
    let dbUnlocked = false;
    let dbReachable = true;

    try {
        // Triggers DBManager.ensureUnlocked() lazily — succeeds in
        // production where the unlock happens at app start, and is a
        // no-op on subsequent calls.
        await dbManager.prepare('SELECT 1').get();
        dbUnlocked = !!dbManager.instance;
    } catch {
        // ensureUnlocked() throws if the SQLCipher key isn't set or the
        // DB file is inaccessible. We don't want the healthcheck itself
        // to 500 — the server is up; we just report degraded state.
        dbReachable = false;
    }

    return NextResponse.json(
        {
            status: dbReachable ? 'ok' : 'degraded',
            dbUnlocked,
            uptimeMs: Date.now() - PROCESS_STARTED_AT,
            // NEXT_PUBLIC_APP_VERSION is inlined at build time via
            // next.config.ts. Falls back to npm_package_version (set
            // when npm runs scripts) and finally 'unknown'.
            version: process.env.NEXT_PUBLIC_APP_VERSION
                ?? process.env.npm_package_version
                ?? 'unknown',
        },
        { status: 200 },
    );
}
