import {
    readInstalledPlugins,
    installPluginFromPayload,
    PluginInstallError,
    type PluginPayload,
} from '@/lib/serverPlugins';
import { authedHandler } from '@/lib/route-helpers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * GET /api/plugins
 *   Lists installed plugins (PluginPayload[]). Editor.tsx hits this on
 *   mount when running in the web build (window.electron is undefined) so
 *   plugins are loaded the same way as on Electron.
 */
export const GET = authedHandler('GET /api/plugins', async () => {
    const items = await readInstalledPlugins();
    return NextResponse.json({ plugins: items satisfies PluginPayload[] });
});

const InstallSchema = z.object({
    id: z.string().min(1).max(128),
    manifest: z.record(z.string(), z.unknown()),
    scriptContent: z.string().min(1).max(2 * 1024 * 1024),
});

/**
 * POST /api/plugins  { id, manifest, scriptContent }
 *   Install a plugin. The renderer builds the payload from a folder the
 *   user picked locally (browser File API reads manifest.json + main.js)
 *   and POSTs it as JSON. Server validates, sanitises the id, and writes
 *   the two files into [pluginsDir]/<id>/.
 *
 *   Idempotent: reposting overwrites the existing plugin.
 *
 *   Auth-gated. On a multi-user self-host, ANY logged-in user can install
 *   plugins — the trust model is "trusted local scripts", same as the
 *   Electron menu. Operators who don't want this should restrict
 *   registration or run with JOURNAL_PLUGINS_DIR pointing at a read-only
 *   mount.
 */
export const POST = authedHandler<[NextRequest]>('POST /api/plugins', async (_userId, req) => {
    const body = await req.json().catch(() => ({}));
    const parsed = InstallSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    try {
        const res = await installPluginFromPayload(parsed.data);
        return NextResponse.json({ installed: res.id });
    } catch (err) {
        if (err instanceof PluginInstallError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
        }
        throw err;
    }
});
