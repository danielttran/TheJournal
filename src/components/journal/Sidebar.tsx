"use client";

import { ChevronLeft, ChevronRight, Search, Menu, Settings, Book, FileText, ChevronDown, ChevronRight as ChevronRightIcon, Plus, Folder, File, GripVertical } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
    defaultDropAnimationSideEffects,
    DropAnimation,
    DragOverEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SidebarProps {
    categoryId: string;
    userId: string;
    title: string;
    type: string;
}

interface Entry {
    EntryID: number;
    Title: string;
    ParentEntryID: number | null;
    EntryType: 'Page' | 'Section';
    SortOrder: number;
    children?: Entry[];
}

// Helper to flat pages for simpler DnD context if needed, but we keep recursive
// Important: dnd-kit IDs should be strings

const SortableNotebookItem = ({ entry, level, onSelect, onAddPage, onAddSection, selectedId, isOverlay }: {
    entry: Entry,
    level: number,
    onSelect: (id: number) => void,
    onAddPage: (parentId: number) => void,
    onAddSection: (parentId: number) => void,
    selectedId: number | null,
    isOverlay?: boolean
}) => {
    const [isOpen, setIsOpen] = useState(true);
    const isSelected = selectedId === entry.EntryID;
    const hasChildren = entry.children && entry.children.length > 0;

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: entry.EntryID, // Keeping number ID, dnd-kit casts to string internally usually, but best to be safe
        data: {
            type: 'Entry',
            entry
        }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        paddingLeft: `${level * 12 + 8}px`,
        opacity: isDragging ? 0.3 : 1,
    };

    if (isOverlay) {
        return (
            <div
                className={`
                    flex items-center justify-between px-2 py-1.5 rounded cursor-grabbing bg-gray-800 text-white shadow-lg border border-gray-700
                `}
                style={{ paddingLeft: `${level * 12 + 8}px` }}
            >
                <div className="flex items-center overflow-hidden">
                    <GripVertical className="w-3 h-3 mr-1 text-gray-500" />
                    {entry.EntryType === 'Section' ? (
                        <Folder className="w-4 h-4 mr-2 text-yellow-500" />
                    ) : (
                        <File className="w-4 h-4 mr-2 text-blue-400" />
                    )}
                    <span className="truncate">{entry.Title || 'Untitled'}</span>
                </div>
            </div>
        );
    }

    return (
        <div ref={setNodeRef} style={style} {...attributes}>
            <div
                className={`
                    group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-sm select-none
                    ${isSelected ? 'bg-purple-900/40 text-purple-200' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'}
                `}
                onClick={(e) => {
                    e.stopPropagation();
                    if (entry.EntryType === 'Section') {
                        setIsOpen(!isOpen);
                    } else {
                        onSelect(entry.EntryID);
                    }
                }}
            >
                <div className="flex items-center overflow-hidden flex-1">
                    <div {...listeners} className="cursor-grab hover:text-white mr-1 active:cursor-grabbing" onClick={e => e.stopPropagation()}>
                        <GripVertical className="w-3 h-3 text-gray-600 hover:text-gray-400" />
                    </div>

                    <span
                        className={`mr-1 p-0.5 rounded hover:bg-gray-700/50 ${entry.EntryType !== 'Section' && 'invisible'}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(!isOpen);
                        }}
                    >
                        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
                    </span>
                    {entry.EntryType === 'Section' ? (
                        <Folder className="w-4 h-4 mr-2 text-yellow-500/80" />
                    ) : (
                        <File className="w-4 h-4 mr-2 text-blue-400/80" />
                    )}
                    <span className="truncate">{entry.Title || 'Untitled'}</span>
                </div>

                {/* Hover Actions */}
                <div className="hidden group-hover:flex items-center space-x-1">
                    {entry.EntryType === 'Section' && (
                        <>
                            <button
                                onClick={(e) => { e.stopPropagation(); onAddPage(entry.EntryID); }}
                                className="p-0.5 hover:bg-gray-700 rounded text-gray-500 hover:text-white" title="Add Page"
                            >
                                <File className="w-3 h-3" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onAddSection(entry.EntryID); }}
                                className="p-0.5 hover:bg-gray-700 rounded text-gray-500 hover:text-white" title="Add Section"
                            >
                                <Folder className="w-3 h-3" />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {hasChildren && isOpen && (
                <div className="flex flex-col">
                    <SortableContext
                        items={entry.children!.map(c => c.EntryID)}
                        strategy={verticalListSortingStrategy}
                    >
                        {entry.children!.map(child => (
                            <SortableNotebookItem
                                key={child.EntryID}
                                entry={child}
                                level={level + 1}
                                onSelect={onSelect}
                                onAddPage={onAddPage}
                                onAddSection={onAddSection}
                                selectedId={selectedId}
                            />
                        ))}
                    </SortableContext>
                </div>
            )}
        </div>
    );
};

export default function Sidebar({ categoryId, userId, title, type }: SidebarProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Journal Mode: Date Selection
    const urlDate = searchParams.get('date');
    const urlEntryId = searchParams.get('entry') ? parseInt(searchParams.get('entry')!, 10) : null;

    const selectedDate = urlDate ? (() => {
        const [y, m, d] = urlDate.split('-').map(Number);
        return new Date(y, m - 1, d);
    })() : new Date();
    const [currentMonth, setCurrentMonth] = useState(new Date());

    // Notebook Mode: Pages List (Flat -> Tree)
    const [pages, setPages] = useState<Entry[]>([]);
    const [activeDragId, setActiveDragId] = useState<number | null>(null);
    const [activeDragItem, setActiveDragItem] = useState<Entry | null>(null);

    // Journal Mode: Entries List (Tree)
    const [journalEntries, setJournalEntries] = useState<any[]>([]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    useEffect(() => {
        if (type === 'Notebook') {
            fetchPages();
        } else if (type === 'Journal') {
            fetchJournalEntries();
        }

        const handleUpdate = () => {
            if (type === 'Notebook') fetchPages();
            if (type === 'Journal') fetchJournalEntries();
        };

        window.addEventListener('journal-entry-updated', handleUpdate);
        return () => window.removeEventListener('journal-entry-updated', handleUpdate);
    }, [categoryId, type]);

    const fetchPages = async () => {
        try {
            const res = await fetch(`/api/entry?categoryId=${categoryId}`);
            const data = await res.json();
            if (Array.isArray(data)) setPages(buildTree(data));
        } catch (e) {
            console.error(e);
        }
    };

    const buildTree = (entries: any[]) => {
        const map = new Map<number, Entry>();
        const roots: Entry[] = [];

        // Initialize map
        entries.forEach(e => {
            map.set(e.EntryID, { ...e, children: [] });
        });

        // Build hierarchy
        entries.forEach(e => {
            if (e.ParentEntryID && map.has(e.ParentEntryID)) {
                map.get(e.ParentEntryID)!.children!.push(map.get(e.EntryID)!);
            } else {
                roots.push(map.get(e.EntryID)!);
            }
        });

        // Sort children
        const sortNodes = (nodes: Entry[]) => {
            nodes.sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
            nodes.forEach(n => {
                if (n.children && n.children.length > 0) {
                    sortNodes(n.children);
                }
            });
        };
        sortNodes(roots);

        return roots;
    };


    const fetchJournalEntries = async () => {
        try {
            const res = await fetch(`/api/entry/dates?categoryId=${categoryId}`);
            const data = await res.json();
            if (Array.isArray(data)) setJournalEntries(data);
        } catch (e) {
            console.error(e);
        }
    };

    const onDateClick = (day: Date) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        router.push(`?date=${dateStr}`);
    };

    const groupedEntries = journalEntries.reduce((acc: any, entry: any) => {
        const date = new Date(entry.CreatedDate);
        if (isNaN(date.getTime())) return acc;
        const year = format(date, 'yyyy');
        const month = format(date, 'MMMM');

        if (!acc[year]) acc[year] = {};
        if (!acc[year][month]) acc[year][month] = [];

        acc[year][month].push(entry);
        return acc;
    }, {});

    const onCreateEntry = async (parentId: number | null, entryType: 'Page' | 'Section') => {
        const res = await fetch('/api/entry/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryId,
                userId,
                title: entryType === 'Section' ? 'New Section' : 'Untitled Page',
                parentEntryId: parentId,
                entryType
            })
        });
        const newEntry = await res.json();
        if (newEntry.id) {
            fetchPages();
            if (entryType === 'Page') {
                router.push(`?entry=${newEntry.id}`);
            }
        }
    };

    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

    // Drag and Drop Handlers
    const findItem = (id: number, items: Entry[]): Entry | null => {
        for (const item of items) {
            if (item.EntryID === id) return item;
            if (item.children) {
                const found = findItem(id, item.children);
                if (found) return found;
            }
        }
        return null;
    };

    const handleDragStart = (event: DragStartEvent) => {
        const { active } = event;
        const id = Number(active.id);
        setActiveDragId(id);
        const item = findItem(id, pages);
        setActiveDragItem(item);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveDragId(null);
        setActiveDragItem(null);

        if (!over) return;

        const activeId = Number(active.id);
        const overId = Number(over.id);

        if (activeId === overId) return;

        const overItem = findItem(overId, pages);
        const activeItem = findItem(activeId, pages);

        if (!overItem || !activeItem) return;

        let newParentId: number | null = overItem.ParentEntryID;
        let newSortOrder = (overItem.SortOrder || 0) + 0.5;

        // Reparenting logic: Drop ONTO a Section
        if (overItem.EntryType === 'Section') {
            // If we drop ON a section, we might mean "put inside"
            // But collisions often happen on the item itself. 
            // We need a way to distinguish "insert after" vs "insert inside".
            // For simplicity: Drop ON = Inside. Drop between = Reorder. 
            // Without robust 'DragOver' collision calc, let's assume dropping ON a folder means 'inside'.
            newParentId = overItem.EntryID;
            newSortOrder = (overItem.children?.length || 0) + 1;
        }

        // Update UI Optimistically (Not fully implementing complex tree mutation locally, fetching is safer)

        try {
            await fetch('/api/entry/move', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entryId: activeId,
                    parentId: newParentId,
                    sortOrder: newSortOrder
                })
            });
            fetchPages();
        } catch (e) {
            console.error("Failed to move item", e);
        }
    };

    // Create a flat list of top-level IDs for the SortableContext
    // Note: This only allows sorting root items if we only provide root IDs.
    // Recursive SortableContexts are needed for nested sorting.
    const rootIds = useMemo(() => pages.map(p => p.EntryID), [pages]);

    const dropAnimation: DropAnimation = {
        sideEffects: defaultDropAnimationSideEffects({
            styles: {
                active: {
                    opacity: '0.5',
                },
            },
        }),
    };


    return (
        <div className="w-80 bg-gray-950 border-r border-gray-800 flex flex-col h-full flex-shrink-0">
            {/* Header */}
            <div className="p-4 flex items-center justify-between border-b border-gray-800">
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
                        {type === 'Journal' ? <Book className="text-white w-4 h-4" /> : <FileText className="text-white w-4 h-4" />}
                    </div>
                    <span className="font-medium truncate max-w-[150px]">{title}</span>
                </div>
                <Link href="/dashboard" className="p-1 hover:bg-gray-800 rounded">
                    <ChevronLeft className="w-5 h-5 text-gray-400" />
                </Link>
            </div>

            {/* Content Swapper */}
            {type === 'Journal' ? (
                <>
                    {/* Calendar Widget */}
                    <div className="p-4 border-b border-gray-800">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold">{format(currentMonth, 'MMMM yyyy')}</h3>
                            <div className="flex space-x-1">
                                <button onClick={prevMonth} className="p-1 hover:bg-gray-800 rounded"><ChevronLeft className="w-4 h-4" /></button>
                                <button onClick={nextMonth} className="p-1 hover:bg-gray-800 rounded"><ChevronRight className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-2">
                            <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-sm">
                            {calendarDays.map((day, i) => {
                                const isSelected = isSameDay(day, selectedDate);
                                const isCurrentMonth = isSameMonth(day, currentMonth);
                                return (
                                    <div
                                        key={i}
                                        onClick={() => onDateClick(day)}
                                        className={`
                                            p-1 rounded cursor-pointer flex items-center justify-center h-8 w-8 mx-auto
                                            ${!isCurrentMonth ? 'text-gray-700' : ''}
                                            ${isSelected ? 'bg-blue-600 text-white font-bold' : 'hover:bg-gray-800 text-gray-400'}
                                        `}
                                    >
                                        {format(day, 'd')}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {/* Journal Tree View */}
                    <div className="flex-1 overflow-y-auto p-2">
                        {Object.keys(groupedEntries).sort((a, b) => a.localeCompare(b)).map(year => (
                            <details key={year} open className="group mb-2">
                                <summary className="flex items-center cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 px-2 mt-2 select-none hover:text-gray-300 outline-none">
                                    <span className="mr-1 group-open:rotate-90 transition-transform text-gray-600 inline-block w-3">▸</span>
                                    {year}
                                </summary>
                                {Object.keys(groupedEntries[year]).map(month => (
                                    <div key={month} className="pl-2">
                                        <details open className="group/month">
                                            <summary className="flex items-center cursor-pointer text-sm text-gray-400 hover:text-white py-1 px-2 rounded hover:bg-gray-800 select-none outline-none">
                                                <span className="mr-2 text-[10px] group-open/month:rotate-90 transition-transform inline-block w-3 text-gray-500">▸</span>
                                                {month}
                                            </summary>
                                            <div className="pl-6 space-y-0.5 mt-1 border-l border-gray-800 ml-3">
                                                {groupedEntries[year][month].sort((a: any, b: any) => new Date(a.CreatedDate).getTime() - new Date(b.CreatedDate).getTime()).map((entry: any) => {
                                                    const entryDate = new Date(entry.CreatedDate);
                                                    const isSelected = isSameDay(entryDate, selectedDate);
                                                    const displayTitle = entry.Title && entry.Title !== 'Untitled' ? ` - ${entry.Title}` : '';
                                                    return (
                                                        <div
                                                            key={entry.EntryID}
                                                            onClick={() => onDateClick(entryDate)}
                                                            className={`
                                                                px-2 py-1 rounded cursor-pointer text-sm truncate transition-colors
                                                                ${isSelected ? 'bg-purple-900/40 text-purple-200' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'}
                                                            `}
                                                            title={`${format(entryDate, 'PPP')}${displayTitle}`}
                                                        >
                                                            {format(entryDate, 'd')} ({format(entryDate, 'EEE')}){displayTitle}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </details>
                                    </div>
                                ))}
                            </details>
                        ))}
                    </div>
                </>
            ) : (
                <>
                    {/* Notebook Tree View (Recursive + DnD) */}
                    <div className="flex-1 overflow-y-auto p-2">
                        <div className="flex items-center justify-between px-2 mb-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Notebook</span>
                            <div className="flex space-x-1">
                                <button onClick={() => onCreateEntry(null, 'Page')} className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white" title="New Page">
                                    <File className="w-3 h-3" />
                                </button>
                                <button onClick={() => onCreateEntry(null, 'Section')} className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white" title="New Section">
                                    <Folder className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragStart={handleDragStart}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={rootIds}
                                    strategy={verticalListSortingStrategy}
                                >
                                    {pages.map(entry => (
                                        <SortableNotebookItem
                                            key={entry.EntryID}
                                            entry={entry}
                                            level={0}
                                            onSelect={(id) => router.push(`?entry=${id}`)}
                                            onAddPage={(parentId) => onCreateEntry(parentId, 'Page')}
                                            onAddSection={(parentId) => onCreateEntry(parentId, 'Section')}
                                            selectedId={urlEntryId}
                                        />
                                    ))}
                                </SortableContext>
                                <DragOverlay dropAnimation={dropAnimation}>
                                    {activeDragItem ? (
                                        <SortableNotebookItem
                                            entry={activeDragItem}
                                            level={0}
                                            onSelect={() => { }}
                                            onAddPage={() => { }}
                                            onAddSection={() => { }}
                                            selectedId={null}
                                            isOverlay
                                        />
                                    ) : null}
                                </DragOverlay>
                            </DndContext>

                            {pages.length === 0 && (
                                <div className="text-center py-4 text-gray-600 text-sm">Empty notebook</div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* Footer */}
            <div className="p-4 border-t border-gray-800">
                <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    <span>{type} Mode</span>
                </div>
            </div>
        </div>
    );
}
