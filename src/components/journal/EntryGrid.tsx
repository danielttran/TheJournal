"use client";

import { useState, useEffect, useCallback } from 'react';
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { Entry } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Controls how a click on a grid card is translated into a URL navigation.
 *
 * - 'section'       — notebook section / page  → ?section=id  or  ?entry=id
 * - 'journal-month' — journal day entries       → ?date=YYYY-MM-DD
 * - 'journal-year'  — journal virtual months    → ?month=YYYY-MM  (uses _monthKey)
 */
export type GridMode = 'section' | 'journal-month' | 'journal-year';

interface EntryGridProps {
    entries: Entry[];
    title?: string;
    dataUrl?: string;
    categoryId?: string;
    gridMode?: GridMode;
    onEntryClick?: (entry: Entry) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EntryGrid({
    entries: initialEntries,
    title,
    dataUrl,
    categoryId,
    gridMode = 'section',
    onEntryClick,
}: EntryGridProps) {
    const router = useRouter();
    const [entries, setEntries] = useState(initialEntries);

    useEffect(() => {
        setEntries(initialEntries);
    }, [initialEntries]);

    // Refresh grid when an entry is saved
    useEffect(() => {
        if (!dataUrl) return;

        let retryTimeout: ReturnType<typeof setTimeout>;

        const handleUpdate = async () => {
            const fetchGrid = async () => {
                try {
                    const url = dataUrl.includes('?') ? `${dataUrl}&t=${Date.now()}` : `${dataUrl}?t=${Date.now()}`;
                    const res = await fetch(url);
                    if (res.ok) setEntries(await res.json());
                } catch { /* silent */ }
            };

            fetchGrid();
            retryTimeout = setTimeout(fetchGrid, 300);
        };

        window.addEventListener('journal-entry-updated', handleUpdate);
        return () => {
            clearTimeout(retryTimeout);
            window.removeEventListener('journal-entry-updated', handleUpdate);
        };
    }, [dataUrl]);

    const handleEntryClick = useCallback((entry: Entry) => {
        if (onEntryClick) {
            onEntryClick(entry);
            return;
        }

        const anyEntry = entry as any;

        if (gridMode === 'journal-year') {
            // Virtual month card — navigate to that month's day-list grid
            const monthKey = anyEntry._monthKey ?? entry.CreatedDate?.substring(0, 7);
            if (monthKey) router.push(`?month=${monthKey}`);
            return;
        }

        if (gridMode === 'journal-month') {
            // Real journal day entry — open the editor at that date
            const dateStr = entry.CreatedDate?.split(' ')[0] ?? entry.CreatedDate;
            if (dateStr) router.push(`?date=${dateStr}`);
            return;
        }

        // Default: notebook section / page
        if (entry.EntryType === 'Section') {
            router.push(`?section=${entry.EntryID}`);
        } else {
            router.push(`?entry=${entry.EntryID}`);
        }
    }, [router, gridMode, onEntryClick]);

    if (!entries || entries.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
                <p className="text-lg">No entries found.</p>
            </div>
        );
    }

    return (
        <div className="p-8 h-full overflow-y-auto bg-bg-app transition-colors duration-200">
            {title && <h2 className="text-2xl font-bold mb-6 text-text-primary">{title}</h2>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {entries.map((entry, i) => (
                    <div
                        key={entry.EntryID ?? i}
                        onClick={() => handleEntryClick(entry)}
                        className="bg-bg-card border border-border-primary rounded-xl p-5 cursor-pointer hover:shadow-lg hover:border-accent-primary transition-all duration-200 group flex flex-col h-48"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center space-x-2 overflow-hidden">
                                {entry.Icon && <span className="text-xl leading-none">{entry.Icon}</span>}
                                <h3 className="font-semibold text-lg truncate text-text-primary group-hover:text-accent-primary transition-colors">
                                    {entry.Title || "Untitled"}
                                </h3>
                            </div>
                            {entry.CreatedDate && (
                                <span className="text-xs text-text-muted whitespace-nowrap ml-2">
                                    {format(new Date(entry.CreatedDate), 'MMM d, yyyy')}
                                </span>
                            )}
                        </div>

                        <div className="flex-1 overflow-hidden relative">
                            <p className="text-sm text-text-secondary line-clamp-4 leading-relaxed">
                                {entry.PreviewText || (
                                    <span className="italic text-text-muted opacity-60">No additional text...</span>
                                )}
                            </p>
                            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--bg-card)] to-transparent pointer-events-none" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
