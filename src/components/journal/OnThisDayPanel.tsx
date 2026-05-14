"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, X } from 'lucide-react';

interface Anniv {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    CreatedDate: string;
    Icon: string | null;
}

interface Props { onClose: () => void; }

export default function OnThisDayPanel({ onClose }: Props) {
    const router = useRouter();
    const [items, setItems] = useState<Anniv[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const ctl = new AbortController();
        fetch('/api/on-this-day', { signal: ctl.signal })
            .then(r => r.ok ? r.json() : { items: [] })
            .then(d => { if (!ctl.signal.aborted) setItems(d.items ?? []); })
            .catch(err => { if (err?.name !== 'AbortError') throw err; })
            .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
        return () => ctl.abort();
    }, []);

    const today = new Date();
    const todayLabel = today.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

    // Group by year
    const grouped = items.reduce<Record<string, Anniv[]>>((acc, item) => {
        const yr = item.CreatedDate.slice(0, 4);
        (acc[yr] ??= []).push(item);
        return acc;
    }, {});
    const years = Object.keys(grouped).sort();

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">On this day · {todayLabel}</h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {loading && <div className="text-center text-text-muted py-6">Loading…</div>}
                    {!loading && items.length === 0 && (
                        <div className="text-center text-text-muted py-12">
                            <Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <div>No entries from this day in prior years.</div>
                        </div>
                    )}
                    {!loading && years.map(yr => (
                        <div key={yr}>
                            <div className="text-xs uppercase tracking-wider text-text-muted mb-2">{yr} · {new Date().getFullYear() - parseInt(yr, 10)} year{new Date().getFullYear() - parseInt(yr, 10) === 1 ? '' : 's'} ago</div>
                            <div className="space-y-1">
                                {grouped[yr].map(item => (
                                    <button
                                        key={item.EntryID}
                                        type="button"
                                        onClick={() => {
                                            router.push(`/journal/${item.CategoryID}?entry=${item.EntryID}`);
                                            onClose();
                                        }}
                                        className="w-full flex items-center gap-2 p-2 hover:bg-bg-hover rounded text-sm text-text-primary text-left"
                                    >
                                        {item.Icon && <span>{item.Icon}</span>}
                                        <span className="truncate flex-1">{item.Title || 'Untitled'}</span>
                                        <span className="text-xs text-text-muted">{item.CategoryName}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
