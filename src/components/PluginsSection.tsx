"use client";

import { useEffect, useState, useRef } from 'react';
import { Trash2, Upload, RefreshCw, FolderOpen } from 'lucide-react';

interface InstalledPlugin {
    id: string;
    manifest: {
        name?: string;
        version?: string;
        description?: string;
    };
}

/**
 * Plugin management UI. Works in BOTH modes:
 *   - Electron: posts to /api/plugins which writes into the server's
 *     plugin folder. The existing Electron Plugins menu (Install Plugin /
 *     Open Plugins Folder) keeps working too — it touches a different
 *     directory ([userData]/plugins).
 *   - Web: same /api/plugins path, no menu equivalent — this is the only
 *     way to add a plugin without ssh.
 *
 * Install flow: user picks a folder via <input webkitdirectory>. We read
 * manifest.json + main.js client-side and POST the parsed payload as JSON.
 * No zip extraction needed on the server.
 */
export default function PluginsSection() {
    const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/plugins');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { plugins: InstalledPlugin[] };
            setPlugins(Array.isArray(data.plugins) ? data.plugins : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleFolderPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';  // allow re-picking the same folder
        if (files.length === 0) return;

        // Files come back with `webkitRelativePath` like "my-plugin/manifest.json".
        // The first path segment is the folder name; we infer the plugin id
        // from it (the server re-sanitises).
        const findFile = (name: string) =>
            files.find(f => f.webkitRelativePath.endsWith(`/${name}`));
        const manifestFile = findFile('manifest.json');
        const scriptFile = findFile('main.js');

        if (!manifestFile || !scriptFile) {
            setError('Folder must contain both manifest.json and main.js.');
            return;
        }

        setInstalling(true);
        setError(null);
        try {
            const [manifestRaw, scriptContent] = await Promise.all([
                manifestFile.text(),
                scriptFile.text(),
            ]);
            let manifest: Record<string, unknown>;
            try { manifest = JSON.parse(manifestRaw); }
            catch (err) {
                throw new Error(`manifest.json is not valid JSON: ${err instanceof Error ? err.message : err}`);
            }

            // Derive plugin id: manifest.id wins, else the folder name from
            // the file path. Server sanitises again.
            const folderName = manifestFile.webkitRelativePath.split('/')[0];
            const id = typeof manifest.id === 'string' && manifest.id.length > 0
                ? manifest.id
                : folderName;

            const res = await fetch('/api/plugins', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, manifest, scriptContent }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body?.error ? JSON.stringify(body.error) : `HTTP ${res.status}`);
            }
            await load();
            // The editor reads plugins only on initial mount. Tell the user.
            if (confirm(`Installed "${id}". Reload now to make it available to the editor?`)) {
                window.location.reload();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setInstalling(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm(`Remove plugin "${id}"? Existing entries that used this plugin will render as static HTML until it is reinstalled.`)) return;
        setError(null);
        try {
            const res = await fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body?.error ? JSON.stringify(body.error) : `HTTP ${res.status}`);
            }
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <section>
            <h3 className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">Plugins</h3>
            <p className="text-xs text-text-muted mb-3">
                Trusted local scripts that extend the editor. Pick a folder containing
                <code className="mx-1 px-1 rounded bg-bg-active border border-border-primary">manifest.json</code>
                and
                <code className="mx-1 px-1 rounded bg-bg-active border border-border-primary">main.js</code>
                to install. Reload the app after install or remove to apply changes.
            </p>

            <div className="flex items-center gap-2 mb-3">
                <button
                    onClick={() => folderInputRef.current?.click()}
                    disabled={installing}
                    className="px-3 py-1.5 bg-accent-primary text-white rounded text-sm flex items-center gap-2 disabled:opacity-50"
                >
                    <Upload className="w-3.5 h-3.5" />
                    {installing ? 'Installing…' : 'Install plugin…'}
                </button>
                <button
                    onClick={load}
                    disabled={loading}
                    className="px-3 py-1.5 bg-bg-active text-text-primary rounded text-sm flex items-center gap-2"
                    title="Refresh the list"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
                <input
                    ref={folderInputRef}
                    type="file"
                    // @ts-expect-error — webkitdirectory is a non-standard attribute supported by all major browsers.
                    webkitdirectory=""
                    directory=""
                    multiple
                    className="hidden"
                    onChange={handleFolderPick}
                />
            </div>

            {error && (
                <div className="mb-3 p-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded">
                    {error}
                </div>
            )}

            {!loading && plugins.length === 0 && (
                <div className="text-xs text-text-muted italic flex items-center gap-2">
                    <FolderOpen className="w-3.5 h-3.5" />
                    No plugins installed yet.
                </div>
            )}

            {plugins.length > 0 && (
                <div className="space-y-2">
                    {plugins.map(p => (
                        <div key={p.id} className="flex items-start justify-between gap-3 p-3 border border-border-primary rounded-lg">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                    <span className="font-medium text-text-primary truncate">
                                        {p.manifest.name || p.id}
                                    </span>
                                    {p.manifest.version && (
                                        <span className="text-[10px] text-text-muted font-mono">v{p.manifest.version}</span>
                                    )}
                                </div>
                                <div className="text-[11px] text-text-muted font-mono truncate">{p.id}</div>
                                {p.manifest.description && (
                                    <p className="text-xs text-text-secondary mt-1">{p.manifest.description}</p>
                                )}
                            </div>
                            <button
                                onClick={() => handleDelete(p.id)}
                                className="p-1 rounded hover:bg-red-500/10 text-red-400 flex-shrink-0"
                                title="Uninstall plugin"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
