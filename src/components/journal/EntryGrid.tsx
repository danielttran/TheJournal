"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { Folder, File } from 'lucide-react';
import { Entry } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Controls how a click on a grid card is translated into a URL navigation.
 *
 * - 'section'       — notebook folder / page  → ?folder=id  or  ?entry=id
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

    // Drag state
    const [draggingId, setDraggingId] = useState<number | null>(null);
    const [dragOverId, setDragOverId] = useState<number | null>(null);
    const dragEnterCounters = useRef<Record<number, number>>({});

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
            const monthKey = anyEntry._monthKey ?? entry.CreatedDate?.substring(0, 7);
            if (monthKey) router.push(`?month=${monthKey}`);
            return;
        }

        if (gridMode === 'journal-month') {
            const dateStr = entry.CreatedDate?.split(' ')[0] ?? entry.CreatedDate;
            if (dateStr) router.push(`?date=${dateStr}`);
            return;
        }

        // Default: notebook folder / page
        if (entry.EntryType === 'Folder') {
            router.push(`?folder=${entry.EntryID}`);
        } else {
            router.push(`?entry=${entry.EntryID}`);
        }
    }, [router, gridMode, onEntryClick]);

    // ── Drag-and-drop handlers ──────────────────────────────────────────────
    // Only active in notebook section-grid mode. Notes/folders can be dragged
    // onto a Folder card to move them into that folder.

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, entry: Entry) => {
        if (gridMode !== 'section') return;
        setDraggingId(entry.EntryID);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(entry.EntryID));
    };

    const handleDragEnd = () => {
        setDraggingId(null);
        setDragOverId(null);
        dragEnterCounters.current = {};
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, targetEntry: Entry) => {
        if (gridMode !== 'section') return;
        if (targetEntry.EntryType !== 'Folder') return;
        e.preventDefault();
        const id = targetEntry.EntryID;
        dragEnterCounters.current[id] = (dragEnterCounters.current[id] ?? 0) + 1;
        setDragOverId(id);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>, targetEntry: Entry) => {
        if (gridMode !== 'section') return;
        if (targetEntry.EntryType !== 'Folder') return;
        const id = targetEntry.EntryID;
        dragEnterCounters.current[id] = (dragEnterCounters.current[id] ?? 1) - 1;
        if ((dragEnterCounters.current[id] ?? 0) <= 0) {
            dragEnterCounters.current[id] = 0;
            setDragOverId(null);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>, targetEntry: Entry) => {
        if (gridMode !== 'section') return;
        if (targetEntry.EntryType !== 'Folder') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>, targetEntry: Entry) => {
        if (gridMode !== 'section') return;
        if (targetEntry.EntryType !== 'Folder') return;
        e.preventDefault();

        const dragged = e.dataTransfer.getData('text/plain');
        const draggedId = parseInt(dragged, 10);
        if (!draggedId || draggedId === targetEntry.EntryID) return;

        setDraggingId(null);
        setDragOverId(null);
        dragEnterCounters.current = {};

        // Optimistic: remove from current view immediately
        setEntries(prev => prev.filter(en => en.EntryID !== draggedId));

        try {
            await fetch('/api/entry/move', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entryId: draggedId,
                    parentId: targetEntry.EntryID,
                    sortOrder: Date.now(), // place at bottom
                }),
            });
        } catch {
            // On failure restore the list from server
            if (dataUrl) {
                const res = await fetch(dataUrl);
                if (res.ok) setEntries(await res.json());
            }
        }
    };

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
                {entries.map((entry, i) => {
                    const isFolder = entry.EntryType === 'Folder';
                    const isDragging = draggingId === entry.EntryID;
                    const isDropTarget = isFolder && dragOverId === entry.EntryID;

                    return (
                        <div
                            key={entry.EntryID ?? i}
                            draggable={gridMode === 'section'}
                            onClick={() => handleEntryClick(entry)}
                            onDragStart={(e) => handleDragStart(e, entry)}
                            onDragEnd={handleDragEnd}
                            onDragEnter={(e) => handleDragEnter(e, entry)}
                            onDragLeave={(e) => handleDragLeave(e, entry)}
                            onDragOver={(e) => handleDragOver(e, entry)}
                            onDrop={(e) => handleDrop(e, entry)}
                            className={`
                                relative border rounded-xl p-5 cursor-pointer flex flex-col h-48
                                transition-all duration-200 group select-none
                                ${isFolder
                                    ? 'bg-bg-card/80 border-border-primary hover:border-accent-primary/60'
                                    : 'bg-bg-card border-border-primary hover:border-accent-primary'}
                                ${isDragging ? 'opacity-40 scale-[0.97]' : ''}
                                ${isDropTarget
                                    ? 'border-accent-primary bg-accent-primary/10 shadow-[0_0_0_2px_var(--accent-primary)] scale-[1.02]'
                                    : 'hover:shadow-lg'}
                            `}
                        >
                            {/* Drop indicator badge */}
                            {isDropTarget && (
                                <div className="absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none z-10">
                                    <div className="bg-accent-primary/20 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs font-semibold text-accent-primary border border-accent-primary/40">
                                        Drop to move inside
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center space-x-2 overflow-hidden">
                                    {/* Folder / file icon */}
                                    {!entry.Icon && isFolder && (
                                        <Folder size={16} className="flex-shrink-0 text-accent-primary opacity-70" />
                                    )}
                                    {!entry.Icon && !isFolder && (
                                        <File size={14} className="flex-shrink-0 text-text-muted opacity-50" />
                                    )}
                                    {entry.Icon && <span className="text-xl leading-none">{entry.Icon}</span>}
                                    <h3 className="font-semibold text-lg truncate text-text-primary group-hover:text-accent-primary transition-colors">
                                        {entry.Title || "Untitled"}
                                    </h3>
                                </div>
                                {entry.CreatedDate && !isFolder && (
                                    <span className="text-xs text-text-muted whitespace-nowrap ml-2">
                                        {format(new Date(entry.CreatedDate), 'MMM d, yyyy')}
                                    </span>
                                )}
                            </div>

                            <div className="flex-1 overflow-hidden relative">
                                <p className="text-sm text-text-secondary line-clamp-4 leading-relaxed">
                                    {entry.PreviewText || (
                                        <span className="italic text-text-muted opacity-60">
                                            {isFolder ? 'Folder' : 'No additional text...'}
                                        </span>
                                    )}
                                </p>
                                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--bg-card)] to-transparent pointer-events-none" />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
