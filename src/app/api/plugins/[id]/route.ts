import {
    uninstallPlugin,
    PluginInstallError,
} from '@/lib/serverPlugins';
import { authedHandler } from '@/lib/route-helpers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/plugins/[id]
 *   Uninstall a plugin. Reusing the sanitisation from installPluginFromPayload
 *   means the id can never resolve outside the plugins root.
 */
export const DELETE = authedHandler<[NextRequest, Params]>(
    'DELETE /api/plugins/[id]',
    async (_userId, _req, { params }) => {
        const { id } = await params;
        try {
            const ok = await uninstallPlugin(id);
            return NextResponse.json({ removed: ok });
        } catch (err) {
            if (err instanceof PluginInstallError) {
                return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
            }
            throw err;
        }
    }
);
