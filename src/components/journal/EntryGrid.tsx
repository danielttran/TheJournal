"use client";

import { useState, useEffect } from 'react';
import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
// removed import { Entry } from "@/lib/types"; 

interface Entry {
    EntryID: number;
    Title: string;
    CreatedDate?: string;
    Icon?: string;
    PreviewText?: string;
}


interface EntryGridProps {
    entries: any[];
    onEntryClick?: (entry: any) => void;
    title?: string;
    dataUrl?: string; // URL to fetch fresh data
}

export default function EntryGrid({ entries: initialEntries, onEntryClick, title, dataUrl }: EntryGridProps) {
    const router = useRouter();
    const [entries, setEntries] = useState(initialEntries);

    useEffect(() => {
        setEntries(initialEntries);
    }, [initialEntries]);

    useEffect(() => {
        if (!dataUrl) return;

        const handleUpdate = async () => {
            try {
                // Add timestamp to prevent caching
                const url = dataUrl.includes('?') ? `${dataUrl}&t=${Date.now()}` : `${dataUrl}?t=${Date.now()}`;
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    setEntries(data);
                }
            } catch (e) {
                console.error("Failed to refresh grid", e);
            }
        };

        window.addEventListener('journal-entry-updated', handleUpdate);
        return () => window.removeEventListener('journal-entry-updated', handleUpdate);
    }, [dataUrl]);

    const handleEntryClick = (entry: any) => {
        if (onEntryClick) {
            onEntryClick(entry);
        } else {
            // Default navigation
            router.push(`?entry=${entry.EntryID}`); // Or whatever the date logic is?
            // If it's a journal entry, maybe ?date=...
            // Check entry type or just try entry ID?
            // If it's journal, usually accessing via date is better for context?
            // Sidebar expects ?date= for Journal.
            if (entry.EntryType === 'Section') {
                // router.push(`?section=${entry.EntryID}`); // Drill down?
                // Wait, if I click a Section in a Grid, I probably want to drill down?
                router.push(`?section=${entry.EntryID}`);
            } else if (entry.CreatedDate && !entry.EntryType) {
                // Likely Journal? check "Type" or infer
                // If we are in Journal Category, page.tsx knows.
                // But EntryGrid is generic.
                // Let's assume standard Entry ID view is safe fallback.
                // Actually Sidebar logic:
                // Journal -> ?date=...
                // Notebook -> ?entry=...
            }

            // Let's just use ?entry=ID for now, unless we can pass a "type" prop to Grid
            router.push(`?entry=${entry.EntryID}`);
        }
    };

    if (!entries || entries.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <p className="text-lg">No entries found.</p>
            </div>
        );
    }

    return (
        <div className="p-8 h-full overflow-y-auto bg-bg-app transition-colors duration-200">
            {title && <h2 className="text-2xl font-bold mb-6 text-text-primary">{title}</h2>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {entries.map((entry) => (
                    <div
                        key={entry.EntryID}
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
                            {/* Gradient fade at bottom of text - using CSS variable for from-color is tricky in tailwind gradient-to-t, 
                                but we can try from-bg-card if we defined it as a color, but it's defined as a var. 
                                Tailwind JIT should support `from-[var(--bg-card)]` */}
                            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--bg-card)] to-transparent pointer-events-none"></div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
