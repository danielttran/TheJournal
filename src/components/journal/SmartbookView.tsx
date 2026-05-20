"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Wand2, RefreshCw, Settings } from 'lucide-react';

interface SmartbookEntry {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    CreatedDate: string;
    ModifiedDate: string;
    Tags: string | null;
}

interface SmartbookResponse {
    results: SmartbookEntry[];
    total: number;
}

interface Props {
    categoryId: string;
    categoryName: string;
    onOpenSettings: () => void;
}

export default function SmartbookView({ categoryId, categoryName, onOpenSettings }: Props) {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [results, setResults] = useState<SmartbookEntry[]>([]);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/category/${categoryId}/smartbook`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as SmartbookResponse;
            setResults(Array.isArray(data.results) ? data.results : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [categoryId]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="flex flex-col h-full bg-bg-app text-text-primary">
            <div className="h-10 border-b border-border-primary flex items-center justify-between px-4 bg-bg-sidebar flex-shrink-0">
                <div className="flex items-center gap-2 text-text-secondary text-sm">
                    <Wand2 className="w-4 h-4 text-accent-primary" />
                    <span className="font-semibold text-text-primary">{categoryName}</span>
                    <span className="text-text-muted">— Smartbook</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={load}
                        className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
                        title="Refresh results"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={onOpenSettings}
                        className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
                        title="Edit Smartbook query"
                    >
                        <Settings className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {error && (
                <div className="px-4 py-2 text-sm text-red-400 bg-red-500/10 border-b border-red-500/30">
                    Could not load results: {error}
                </div>
            )}

            <div className="flex-1 overflow-y-auto">
                {loading && results.length === 0 && (
                    <div className="p-6 text-sm text-text-muted">Loading…</div>
                )}

                {!loading && results.length === 0 && !error && (
                    <div className="p-6 text-sm text-text-muted">
                        No entries match this Smartbook&apos;s query yet. Use the gear icon to edit the query.
                    </div>
                )}

                {results.length > 0 && (
                    <div className="divide-y divide-border-primary">
                        {results.map(entry => {
                            const tags: string[] = (() => {
                                try { return entry.Tags ? JSON.parse(entry.Tags) : []; }
                                catch { return []; }
                            })();
                            return (
                                <button
                                    key={entry.EntryID}
                                    onClick={() => router.push(`/journal/${entry.CategoryID}?entry=${entry.EntryID}`)}
                                    className="w-full text-left px-4 py-3 hover:bg-bg-hover transition-colors flex flex-col gap-1"
                                >
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="font-medium text-text-primary truncate">{entry.Title || 'Untitled'}</span>
                                        <span className="text-[11px] text-text-muted whitespace-nowrap">
                                            {new Date(entry.ModifiedDate || entry.CreatedDate).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
                                        <span className="truncate">{entry.CategoryName}</span>
                                        {tags.length > 0 && (
                                            <span className="flex gap-1 flex-wrap">
                                                {tags.slice(0, 4).map(t => (
                                                    <span key={t} className="px-1.5 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary">
                                                        {t}
                                                    </span>
                                                ))}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
