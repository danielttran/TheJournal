"use client";

import { useEffect, useState, useCallback } from 'react';
import { Trash, RotateCcw, X, Trash2 } from 'lucide-react';

interface TrashItem {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    DeletedDate: string;
}

interface TrashPanelProps {
    onClose: () => void;
    onChanged?: () => void;
}

export default function TrashPanel({ onClose, onChanged }: TrashPanelProps) {
    const [items, setItems] = useState<TrashItem[]>([]);
    const [loading, setLoading] = useState(true);
    // Multi-select for bulk restore / permanent delete (/api/entry/bulk).
    const [selected, setSelected] = useState<Set<number>>(new Set());

    const refresh = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        try {
            const res = await fetch('/api/trash', { signal });
            if (signal?.aborted) return;
            const data = await res.json();
            if (signal?.aborted) return;
            setItems(data.items ?? []);
            setSelected(new Set());
        } catch (err) {
            if ((err as { name?: string })?.name === 'AbortError') return;
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const ctl = new AbortController();
        refresh(ctl.signal);
        return () => ctl.abort();
    }, [refresh]);

    const restore = async (id: number) => {
        await fetch(`/api/trash/${id}/restore`, { method: 'POST' });
        await refresh();
        onChanged?.();
    };

    const permaDelete = async (id: number) => {
        if (!confirm('Permanently delete this entry? This cannot be undone.')) return;
        await fetch(`/api/entry/${id}?permanent=true`, { method: 'DELETE' });
        await refresh();
        onChanged?.();
    };

    const purgeOld = async () => {
        if (!confirm('Permanently delete all entries trashed more than 30 days ago?')) return;
        const res = await fetch('/api/trash?daysOld=30', { method: 'DELETE' });
        const { purged } = await res.json();
        alert(`Purged ${purged} entr${purged === 1 ? 'y' : 'ies'}.`);
        await refresh();
        onChanged?.();
    };

    const toggleSelect = (id: number) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const bulk = async (action: 'restore' | 'permanentDelete') => {
        const ids = [...selected];
        if (ids.length === 0) return;
        if (action === 'permanentDelete'
            && !confirm(`Permanently delete ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}? This cannot be undone.`)) return;
        await fetch('/api/entry/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, entryIds: ids }),
        });
        await refresh();
        onChanged?.();
    };

    const allSelected = items.length > 0 && selected.size === items.length;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <Trash className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Trash</h2>
                        <span className="text-xs text-text-muted">{items.length} item{items.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={purgeOld} className="text-xs text-red-400 hover:underline">Purge 30d+</button>
                        <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                {items.length > 0 && (
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-border-primary bg-bg-sidebar/60">
                        <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={() => setSelected(allSelected ? new Set() : new Set(items.map(i => i.EntryID)))}
                                className="accent-[color:var(--color-accent-primary)]"
                            />
                            Select all
                        </label>
                        {selected.size > 0 && (
                            <>
                                <span className="text-xs text-text-muted">· {selected.size} selected</span>
                                <button onClick={() => void bulk('restore')} className="text-xs text-accent-primary hover:underline">Restore selected</button>
                                <button onClick={() => void bulk('permanentDelete')} className="text-xs text-red-400 hover:underline">Delete selected forever</button>
                            </>
                        )}
                    </div>
                )}
                <div className="flex-1 overflow-y-auto p-3">
                    {loading && <div className="text-center text-text-muted py-6">Loading…</div>}
                    {!loading && items.length === 0 && (
                        <div className="text-center text-text-muted py-12">
                            <Trash className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <div>Trash is empty</div>
                        </div>
                    )}
                    {!loading && items.map(item => (
                        <div key={item.EntryID} className="group flex items-center justify-between gap-3 p-2 hover:bg-bg-hover rounded">
                            <input
                                type="checkbox"
                                checked={selected.has(item.EntryID)}
                                onChange={() => toggleSelect(item.EntryID)}
                                className="flex-shrink-0 accent-[color:var(--color-accent-primary)]"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-text-primary">{item.Title || 'Untitled'}</div>
                                <div className="text-xs text-text-muted truncate">
                                    {item.CategoryName} · deleted {new Date(item.DeletedDate).toLocaleString()}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                    onClick={() => restore(item.EntryID)}
                                    className="p-1.5 rounded hover:bg-bg-card text-accent-primary"
                                    title="Restore"
                                >
                                    <RotateCcw className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => permaDelete(item.EntryID)}
                                    className="p-1.5 rounded hover:bg-bg-card text-red-400"
                                    title="Delete permanently"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
