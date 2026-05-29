"use client";

import { useEffect, useState } from 'react';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

interface VolumeRow { name: string; path: string; sizeBytes?: number; }

/**
 * Web "Journal Volumes" manager. Lists `.tjdb` volumes the server can see
 * (`/api/journals`). Switching the active volume on a shared web server is a
 * deployment concern (the server's JOURNAL_DB_PATH), so this surfaces the
 * volumes and explains that — a real, functional listing rather than a dead
 * "desktop only" dialog. On Electron, the native File menu does live switching.
 */
export default function JournalVolumesModal({ onClose }: { onClose: () => void }) {
    useEscapeToClose(onClose);
    const [dir, setDir] = useState('');
    const [volumes, setVolumes] = useState<VolumeRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async (d?: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/journals${d ? `?dir=${encodeURIComponent(d)}` : ''}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setError(data.error || `HTTP ${res.status}`); setVolumes([]); return; }
            setVolumes(Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : []);
        } catch {
            setError('Could not list volumes.');
        } finally { setLoading(false); }
    };

    useEffect(() => { void load(); }, []);

    return (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl p-5 w-[460px]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-text-primary">Journal Volumes</h2>
                    <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg leading-none">×</button>
                </div>

                <div className="flex gap-2 mb-3">
                    <input value={dir} onChange={e => setDir(e.target.value)} placeholder="Directory to scan (server path)"
                        className="flex-1 p-2 text-sm bg-bg-app border border-border-primary rounded text-text-primary outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]" />
                    <button onClick={() => load(dir)} className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90">Scan</button>
                </div>

                {loading && <div className="text-xs text-text-muted py-2">Loading…</div>}
                {error && <div className="text-xs text-red-400 py-2">{error}</div>}

                <ul className="max-h-48 overflow-y-auto divide-y divide-border-primary mb-3">
                    {volumes.map(v => (
                        <li key={v.path} className="py-1.5 text-sm text-text-primary flex justify-between gap-3">
                            <span className="truncate">{v.name}</span>
                            <span className="text-text-muted text-xs flex-shrink-0">{v.sizeBytes != null ? `${(v.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}</span>
                        </li>
                    ))}
                    {!loading && volumes.length === 0 && <li className="py-2 text-xs text-text-muted">No journal volumes found in this directory.</li>}
                </ul>

                <p className="text-xs text-text-muted border-t border-border-primary pt-3">
                    The active volume for this web deployment is set by the server&apos;s
                    <code className="mx-1 px-1 bg-bg-app rounded">JOURNAL_DB_PATH</code>.
                    Use Backup/Restore (File → Journal Volume Maintenance) to move data between volumes.
                    The desktop app switches volumes live.
                </p>
            </div>
        </div>
    );
}
