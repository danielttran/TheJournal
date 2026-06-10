"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History, X } from 'lucide-react';

interface RecentEntry {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    LastAccessedDate: string;
    Icon: string | null;
}

interface Props { onClose: () => void; }

/** Go ▸ Recent Entries — the last entries you opened, newest first. */
export default function RecentEntriesPanel({ onClose }: Props) {
    const router = useRouter();
    const [items, setItems] = useState<RecentEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const ctl = new AbortController();
        fetch('/api/entry/recent?limit=30', { signal: ctl.signal })
            .then(r => r.ok ? r.json() : { items: [] })
            .then(d => { if (!ctl.signal.aborted) setItems(d.items ?? []); })
            .catch(() => {})
            .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
        return () => ctl.abort();
    }, []);

    function go(e: RecentEntry) {
        router.push(`/journal/${e.CategoryID}?entry=${e.EntryID}`);
        onClose();
    }

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[560px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Recent Entries</h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                    {loading && <div className="text-center text-text-muted py-6">Loading…</div>}
                    {!loading && items.length === 0 && (
                        <div className="text-center text-text-muted py-10 text-sm">
                            No recently opened entries yet.
                        </div>
                    )}
                    {!loading && items.map(e => (
                        <button
                            key={e.EntryID}
                            onClick={() => go(e)}
                            className="w-full text-left flex items-center gap-2 p-2 rounded hover:bg-bg-hover transition-colors"
                        >
                            <span className="text-base leading-none w-5 text-center">{e.Icon || '📄'}</span>
                            <span className="flex-1 truncate text-sm text-text-primary">{e.Title || 'Untitled'}</span>
                            <span className="text-xs text-text-muted truncate max-w-[140px]">{e.CategoryName}</span>
                            <span className="text-[10px] text-text-muted whitespace-nowrap">{e.LastAccessedDate?.slice(0, 16).replace('T', ' ')}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
