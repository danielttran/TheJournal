"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Star, Shuffle, X } from 'lucide-react';

interface FavoriteEntry {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    CreatedDate: string;
    ModifiedDate: string;
    PreviewText: string | null;
}

interface RandomEntry {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CreatedDate: string;
}

interface Props { onClose: () => void; }

/**
 * David RM parity panel — combines the "Favorites" view and the "Surprise me"
 * button. Clicking a favorite or the Surprise me result navigates to that
 * entry. Closes on row click or × button.
 */
export default function FavoritesPanel({ onClose }: Props) {
    const router = useRouter();
    const [items, setItems] = useState<FavoriteEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [surprising, setSurprising] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const ctl = new AbortController();
        fetch('/api/favorites', { signal: ctl.signal })
            .then(r => r.ok ? r.json() : { favorites: [] })
            .then(d => { if (!ctl.signal.aborted) setItems(d.favorites ?? []); })
            .catch(err => { if (err?.name !== 'AbortError') setError(String(err?.message ?? err)); })
            .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
        return () => ctl.abort();
    }, []);

    function go(entry: { EntryID: number; CategoryID: number }) {
        // Match the existing journal route shape.
        router.push(`/journal/${entry.CategoryID}?entryId=${entry.EntryID}` as never);
        onClose();
    }

    async function surpriseMe() {
        setSurprising(true);
        try {
            const r = await fetch('/api/random');
            if (!r.ok) return;
            const { entry } = (await r.json()) as { entry: RandomEntry | null };
            if (entry) go(entry);
        } finally { setSurprising(false); }
    }

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <Star className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Favorites</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={surpriseMe}
                            disabled={surprising}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 disabled:opacity-50"
                            title="Open a random past entry"
                        >
                            <Shuffle className="w-3.5 h-3.5" />
                            {surprising ? 'Picking…' : 'Surprise me'}
                        </button>
                        <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {loading && <div className="text-center text-text-muted py-6">Loading…</div>}
                    {!loading && error && (
                        <div className="text-center text-red-500 py-6 text-sm">{error}</div>
                    )}
                    {!loading && !error && items.length === 0 && (
                        <div className="text-center text-text-muted py-12">
                            <Star className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <p>No starred entries yet.</p>
                            <p className="text-xs mt-1 opacity-70">Open an entry and tap the star to add it here.</p>
                        </div>
                    )}
                    {!loading && !error && items.map(e => (
                        <button
                            key={e.EntryID}
                            onClick={() => go(e)}
                            className="w-full text-left p-3 rounded hover:bg-bg-hover transition-colors border border-transparent hover:border-border-primary"
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-text-primary truncate">{e.Title || 'Untitled'}</span>
                                <span className="text-[10px] text-text-muted whitespace-nowrap">{e.ModifiedDate?.slice(0, 10)}</span>
                            </div>
                            <div className="text-xs text-text-muted truncate mt-0.5">
                                {e.CategoryName}
                                {e.PreviewText ? <span className="opacity-70"> · {e.PreviewText}</span> : null}
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
