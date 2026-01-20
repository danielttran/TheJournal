"use client";

import { ChevronLeft, ChevronRight, Search, Menu, Settings, Book, FileText, ChevronDown, ChevronRight as ChevronRightIcon, Plus, Folder, File, GripVertical, X } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import dynamic from 'next/dynamic';
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

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });


interface SidebarProps {
    categoryId: string;
    userId: string;
    title: string;
    type: string;
    viewSettings?: string;
}

import { Entry } from '@/lib/types';

// ---------------------------
// Sortable Notebook Item (Updated)
// ---------------------------
const SortableNotebookItem = ({ entry, level, onSelect, onAddPage, onAddSection, selectedId, isOverlay, onContextMenu, onRename, onToggleExpand }: {
    entry: Entry,
    level: number,
    onSelect: (id: number, type: 'Page' | 'Section') => void,
    onAddPage: (parentId: number) => void,
    onAddSection: (parentId: number) => void,
    selectedId: number | null,
    isOverlay?: boolean,
    onContextMenu: (e: React.MouseEvent, entryId: number) => void,
    onRename: (id: number, newTitle: string) => void,
    onToggleExpand: (id: number, expanded: boolean) => void
}) => {
    const [isOpen, setIsOpen] = useState(entry.IsExpanded || false);
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(entry.Title);
    const isSelected = selectedId === entry.EntryID;
    const hasChildren = entry.children && entry.children.length > 0;
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync expanded state from props (Server/API truth)
    useEffect(() => {
        setIsOpen(!!entry.IsExpanded);
    }, [entry.IsExpanded]);

    // Auto-focus input
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleExpandToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        const newState = !isOpen;
        setIsOpen(newState);
        onToggleExpand(entry.EntryID, newState);
    };

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.EntryID, data: { type: 'Entry', entry } });
    const style = { transform: CSS.Translate.toString(transform), transition, paddingLeft: `${level * 12 + 8}px`, opacity: isDragging ? 0.3 : 1 };

    const handleSubmitRename = () => {
        if (editTitle.trim() !== entry.Title) {
            onRename(entry.EntryID, editTitle);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSubmitRename();
        if (e.key === 'Escape') {
            setEditTitle(entry.Title);
            setIsEditing(false);
        }
    };

    const DisplayIcon = () => {
        if (entry.Icon) return <span className="mr-2 text-base leading-none">{entry.Icon}</span>;
        if (entry.EntryType === 'Section') return <Folder className="w-4 h-4 mr-2 text-yellow-500" />;
        return <File className="w-4 h-4 mr-2 text-blue-400" />;
    };

    if (isOverlay) return (<div className="flex items-center justify-between px-2 py-1.5 rounded bg-bg-card text-text-primary shadow-lg border border-border-primary" style={{ paddingLeft: `${level * 12 + 8}px` }}><div className="flex items-center overflow-hidden"><GripVertical className="w-3 h-3 mr-1 text-text-muted" /><DisplayIcon /><span className="truncate">{entry.Title || 'Untitled'}</span></div></div>);

    return (
        <div ref={setNodeRef} style={style} {...attributes}>
            <div
                className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-sm select-none ${isSelected ? 'bg-accent-primary/20 text-accent-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
                onClick={(e) => {
                    e.stopPropagation();
                    if (entry.EntryType === 'Section') onSelect(entry.EntryID, 'Section');
                    else onSelect(entry.EntryID, 'Page');
                }}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (entry.EntryType === 'Section') {
                        setIsEditing(true);
                        setEditTitle(entry.Title);
                    }
                }}
                onContextMenu={(e) => onContextMenu(e, entry.EntryID)}
            >
                <div className="flex items-center overflow-hidden flex-1">
                    <div {...listeners} className="cursor-grab hover:text-text-primary mr-1 active:cursor-grabbing" onClick={e => e.stopPropagation()}><GripVertical className="w-3 h-3 text-text-muted hover:text-text-secondary" /></div>

                    {/* Arrow for Expansion */}
                    <span
                        className={`mr-1 p-0.5 rounded hover:bg-bg-active cursor-pointer ${entry.EntryType !== 'Section' && 'invisible'}`}
                        onClick={handleExpandToggle}
                    >
                        <ChevronRightIcon className={`w-3 h-3 transition-transform text-text-muted ${isOpen ? 'rotate-90' : ''}`} />
                    </span>

                    <DisplayIcon />

                    {isEditing ? (
                        <input
                            ref={inputRef}
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            onBlur={handleSubmitRename}
                            onKeyDown={handleKeyDown}
                            onClick={e => e.stopPropagation()}
                            className="bg-bg-active text-text-primary border border-accent-primary rounded px-1 py-0.5 text-xs w-full focus:outline-none"
                        />
                    ) : (
                        <span className="truncate">{entry.Title || 'Untitled'}</span>
                    )}
                </div>
                <div className="hidden group-hover:flex items-center space-x-1">
                    {entry.EntryType === 'Section' && (<><button onClick={(e) => { e.stopPropagation(); onAddPage(entry.EntryID); }} className="p-0.5 hover:bg-bg-active rounded text-text-muted hover:text-text-primary"><File className="w-3 h-3" /></button><button onClick={(e) => { e.stopPropagation(); onAddSection(entry.EntryID); }} className="p-0.5 hover:bg-bg-active rounded text-text-muted hover:text-text-primary"><Folder className="w-3 h-3" /></button></>)}
                </div>
            </div>
            {hasChildren && isOpen && (
                <div className="flex flex-col">
                    <SortableContext items={entry.children!.map(c => c.EntryID)} strategy={verticalListSortingStrategy}>
                        {entry.children!.map(child => (
                            <SortableNotebookItem key={child.EntryID} entry={child} level={level + 1} onSelect={onSelect} onAddPage={onAddPage} onAddSection={onAddSection} selectedId={selectedId} onContextMenu={onContextMenu} onRename={onRename} onToggleExpand={onToggleExpand} />
                        ))}
                    </SortableContext>
                </div>
            )}
        </div>
    );
};

// ---------------------------
// Main Sidebar Component
// ---------------------------
export default function Sidebar({ categoryId, userId, title, type, viewSettings }: SidebarProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { theme } = useTheme();

    // Journal Expanded State (Persistent)
    const [journalExpanded, setJournalExpanded] = useState<Record<string, boolean>>(() => {
        try {
            return viewSettings ? JSON.parse(viewSettings) : {};
        } catch { return {}; }
    });

    const updateJournalExpansion = async (newExpanded: Record<string, boolean>) => {
        setJournalExpanded(newExpanded);
        // Persist
        try {
            await fetch(`/api/category/${categoryId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ viewSettings: newExpanded })
            });
        } catch (e) { /* silence */ }
    };

    const toggleJournalNode = (key: string) => {
        const newState = { ...journalExpanded, [key]: !journalExpanded[key] };
        updateJournalExpansion(newState);
    };

    const handleNotebookExpandToggle = async (id: number, expanded: boolean) => {
        try {
            await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isExpanded: expanded, userId })
            });
            // Optimization: Don't strictly need to fetchPages here if local state handles it, 
            // but fetching ensures consistency.
            // fetchPages(); 
            // Better: update local state in Sidebar? But tree is deep. 
            // Let's rely on recursive setPages logic update or just individual update?
            // Since we passed fetchPages on Update, actually let's NOT fetchPages to avoid UI jump. 
            // Updates will come on next load. BUT user wants persist.
            // The item component handles local UI state. The API handles persistence.
        } catch (e) { /* silence */ }
    };


    // Journal Mode
    const urlDate = searchParams.get('date');
    const urlEntryId = searchParams.get('entry') ? parseInt(searchParams.get('entry')!, 10) : null;
    const urlSectionId = searchParams.get('section') ? parseInt(searchParams.get('section')!, 10) : null;

    // Combine for highlighting
    const selectedId = urlEntryId || urlSectionId;

    const selectedDate = urlDate ? (() => {
        const [y, m, d] = urlDate.split('-').map(Number);
        return new Date(y, m - 1, d);
    })() : new Date();
    const [currentMonth, setCurrentMonth] = useState(new Date());

    // Notebook Mode
    const [pages, setPages] = useState<Entry[]>([]);
    const [activeDragId, setActiveDragId] = useState<number | null>(null);
    const [activeDragItem, setActiveDragItem] = useState<Entry | null>(null);
    const [journalEntries, setJournalEntries] = useState<any[]>([]);

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; entryId: number | null }>({
        visible: false, x: 0, y: 0, entryId: null
    });
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    useEffect(() => {
        if (type === 'Notebook') fetchPages();
        else if (type === 'Journal') fetchJournalEntries();

        const handleUpdate = () => {
            // Immediate fetch (fast)
            if (type === 'Notebook') fetchPages();
            if (type === 'Journal') fetchJournalEntries();

            // Delayed fetch (catch race conditions)
            setTimeout(() => {
                if (type === 'Notebook') fetchPages();
                if (type === 'Journal') fetchJournalEntries();
            }, 300);
        };
        window.addEventListener('journal-entry-updated', handleUpdate);

        const handleClickOutside = () => {
            setContextMenu(prev => ({ ...prev, visible: false }));
        };
        document.addEventListener('click', handleClickOutside);

        return () => {
            window.removeEventListener('journal-entry-updated', handleUpdate);
            document.removeEventListener('click', handleClickOutside);
        };
    }, [categoryId, type]);

    const fetchPages = async () => {
        try {
            const res = await fetch(`/api/entry?categoryId=${categoryId}&t=${Date.now()}`);
            const data = await res.json();
            if (Array.isArray(data)) setPages(buildTree(data));
        } catch (e) { /* silence */ }
    };

    const buildTree = (entries: Entry[]) => {
        const map = new Map<number, Entry>();
        const roots: Entry[] = [];
        entries.forEach(e => map.set(e.EntryID, { ...e, children: [] }));
        entries.forEach(e => {
            if (e.ParentEntryID && map.has(e.ParentEntryID)) map.get(e.ParentEntryID)!.children!.push(map.get(e.EntryID)!);
            else roots.push(map.get(e.EntryID)!);
        });
        const sortNodes = (nodes: Entry[]) => {
            nodes.sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
            nodes.forEach(n => { if (n.children?.length) sortNodes(n.children); });
        };
        sortNodes(roots);
        return roots;
    };

    const fetchJournalEntries = async () => {
        try {
            const res = await fetch(`/api/entry/dates?categoryId=${categoryId}&t=${Date.now()}`); // Bust cache
            const data = await res.json();
            if (Array.isArray(data)) setJournalEntries(data);
        } catch (e) { /* silence */ }
    };

    const handleContextMenu = (e: React.MouseEvent, entryId: number) => {
        e.preventDefault();
        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, entryId });
        setShowEmojiPicker(false);
    };

    const handleIconChange = async (entryId: number, icon: string) => {
        const res = await fetch(`/api/entry/${entryId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icon: icon, userId })
        });
        if (type === 'Journal') fetchJournalEntries();
        else fetchPages();

        setContextMenu(prev => ({ ...prev, visible: false }));
        setShowEmojiPicker(false);
    };

    const handleRename = async (id: number, newTitle: string) => {
        try {
            await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle, userId })
            }); // Optimistic update possible, but fetching is safer
            if (type === 'Notebook') fetchPages();
            else fetchJournalEntries();
        } catch (e) { /* silence */ }
    };

    // ... (Date/Journal Logic same as before)
    const onDateClick = (day: Date) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        router.push(`?date=${dateStr}`);
    };
    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

    const groupedEntries = journalEntries.reduce((acc: Record<string, Record<string, { entries: Entry[], key: string }>>, entry: Entry) => {
        if (!entry.CreatedDate) return acc;
        const date = new Date(entry.CreatedDate);
        if (isNaN(date.getTime())) return acc;
        const year = format(date, 'yyyy');
        const month = format(date, 'MMMM');
        const monthKey = format(date, 'yyyy-MM');
        if (!acc[year]) acc[year] = {};
        if (!acc[year][month]) acc[year][month] = { entries: [], key: monthKey };
        acc[year][month].entries.push(entry);
        return acc;
    }, {});

    const onCreateEntry = async (parentId: number | null, entryType: 'Page' | 'Section') => {
        const res = await fetch('/api/entry/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId, userId, title: entryType === 'Section' ? 'New Section' : 'Untitled Page', parentEntryId: parentId, entryType })
        });
        const newEntry = await res.json();
        if (newEntry.id) {
            fetchPages();
            if (entryType === 'Page') router.push(`?entry=${newEntry.id}`);
        }
    };

    // ... (DnD Logic same as before, simplified for brevity in reasoning but included in full code)
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
    const handleDragStart = (e: DragStartEvent) => {
        setActiveDragId(Number(e.active.id));
        setActiveDragItem(findItem(Number(e.active.id), pages));
    };
    const handleDragEnd = async (e: DragEndEvent) => {
        const { active, over } = e;
        setActiveDragId(null);
        setActiveDragItem(null);
        if (!over) return;
        const activeId = Number(active.id);
        const overId = Number(over.id);
        if (activeId === overId) return;
        const overItem = findItem(overId, pages);
        const activeItem = findItem(activeId, pages);
        if (!overItem || !activeItem) return;
        let newParentId = overItem.ParentEntryID;
        let newSortOrder = (overItem.SortOrder || 0) + 0.5;
        if (overItem.EntryType === 'Section') { newParentId = overItem.EntryID; newSortOrder = (overItem.children?.length || 0) + 1; }
        try {
            await fetch('/api/entry/move', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: activeId, parentId: newParentId, sortOrder: newSortOrder }) });
            fetchPages();
        } catch (err) { /* silence */ }
    };
    const rootIds = useMemo(() => pages.map(p => p.EntryID), [pages]);
    const dropAnimation: DropAnimation = { sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }) };

    // Calendar
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

    return (
        <div className="w-80 bg-bg-sidebar border-r border-border-primary flex flex-col h-full flex-shrink-0 relative transition-colors duration-200">
            {/* Header */}
            <div className="p-4 flex items-center justify-between border-b border-border-primary">
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-accent-primary rounded-lg flex items-center justify-center">
                        {type === 'Journal' ? <Book className="text-white w-4 h-4" /> : <FileText className="text-white w-4 h-4" />}
                    </div>
                    <span className="font-medium truncate max-w-[150px] text-text-primary">{title}</span>
                </div>
            </div>

            {/* Content Switcher */}
            {type === 'Journal' ? (
                <>
                    {/* Calendar Widget */}
                    <div className="p-4 border-b border-border-primary">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold text-text-primary">{format(currentMonth, 'MMMM yyyy')}</h3>
                            <div className="flex space-x-1">
                                <button onClick={prevMonth} className="p-1 hover:bg-bg-hover rounded text-text-secondary"><ChevronLeft className="w-4 h-4" /></button>
                                <button onClick={nextMonth} className="p-1 hover:bg-bg-hover rounded text-text-secondary"><ChevronRight className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-muted mb-2"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
                        <div className="grid grid-cols-7 gap-1 text-sm">
                            {calendarDays.map((day, i) => {
                                const isSelected = isSameDay(day, selectedDate);
                                const isCurrentMonth = isSameMonth(day, currentMonth);
                                const entryForDay = journalEntries.find(e => isSameDay(new Date(e.CreatedDate), day));
                                return (
                                    <div
                                        key={i}
                                        onClick={() => onDateClick(day)}
                                        className={`p-1 rounded cursor-pointer flex items-center justify-center h-8 w-8 mx-auto ${!isCurrentMonth ? 'text-text-muted opacity-50' : ''} ${isSelected ? 'bg-accent-primary text-white font-bold' : 'hover:bg-bg-hover text-text-secondary'}`}
                                        title={entryForDay?.Title || ""}
                                    >
                                        {entryForDay?.Icon ? <span className="text-base leading-none">{entryForDay.Icon}</span> : format(day, 'd')}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {/* Journal Tree */}
                    <div className="flex-1 overflow-y-auto p-2">
                        {Object.keys(groupedEntries).sort((a, b) => a.localeCompare(b)).map(year => {
                            const isYearOpen = journalExpanded[year] !== false; // Default Open if undefined? Or default closed. Let's say default Open.
                            // If user never toggled, it's undefined. If I want default open: use !== false. 
                            return (
                                <div key={year} className="mb-2">
                                    <div className="flex items-center cursor-pointer text-xs font-semibold text-text-muted uppercase tracking-wider mb-1 px-2 mt-2 select-none hover:text-text-secondary" onClick={() => toggleJournalNode(year)}>
                                        <ChevronRightIcon className={`mr-1 w-3 h-3 transition-transform text-text-muted ${isYearOpen ? 'rotate-90' : ''}`} />
                                        {year}
                                    </div>
                                    {isYearOpen && Object.keys(groupedEntries[year]).map(month => {
                                        const monthKey = groupedEntries[year][month].key;
                                        const isMonthOpen = journalExpanded[monthKey] !== false; // Default Open
                                        return (
                                            <div key={month} className="pl-2">
                                                <div className="group/month">
                                                    <div className="flex items-center text-sm text-text-secondary hover:text-text-primary py-1 px-2 rounded hover:bg-bg-hover select-none outline-none">
                                                        <span
                                                            className="cursor-pointer p-0.5 rounded hover:bg-bg-active mr-1"
                                                            onClick={(e) => { e.stopPropagation(); toggleJournalNode(monthKey); }}
                                                        >
                                                            <ChevronRightIcon className={`w-3 h-3 transition-transform text-text-muted ${isMonthOpen ? 'rotate-90' : ''}`} />
                                                        </span>
                                                        <span
                                                            className="flex-1 cursor-pointer"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                router.push(`?month=${monthKey}`);
                                                            }}
                                                        >
                                                            {month}
                                                        </span>
                                                    </div>
                                                    {isMonthOpen && (
                                                        <div className="pl-6 space-y-0.5 mt-1 border-l border-border-primary ml-3">
                                                            {groupedEntries[year][month].entries.sort((a: Entry, b: Entry) => new Date(a.CreatedDate!).getTime() - new Date(b.CreatedDate!).getTime()).map((entry: Entry) => (
                                                                <div
                                                                    key={entry.EntryID}
                                                                    onClick={() => onDateClick(new Date(entry.CreatedDate!))}
                                                                    onContextMenu={(e) => handleContextMenu(e, entry.EntryID)}
                                                                    className={`px-2 py-1 rounded cursor-pointer text-sm truncate transition-colors flex items-center ${isSameDay(new Date(entry.CreatedDate!), selectedDate) ? 'bg-accent-primary/20 text-accent-primary' : 'text-text-secondary hover:bg-bg-hover'}`}
                                                                >
                                                                    {entry.Icon && <span className="mr-2 text-xs">{entry.Icon}</span>}
                                                                    <span className="truncate">
                                                                        {format(new Date(entry.CreatedDate!), 'd')} ({format(new Date(entry.CreatedDate!), 'EEE')}){entry.Title && entry.Title !== 'Untitled' ? ` - ${entry.Title}` : ''}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : (
                <>
                    {/* Notebook Tree */}
                    <div className="flex-1 overflow-y-auto p-2 pb-20">
                        <div className="flex items-center justify-between px-2 mb-2">
                            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Notebook</span>
                            <div className="flex space-x-1">
                                <button onClick={() => onCreateEntry(null, 'Page')} className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary"><File className="w-3 h-3" /></button>
                                <button onClick={() => onCreateEntry(null, 'Section')} className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary"><Folder className="w-3 h-3" /></button>
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                                <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
                                    {pages.map(entry => (
                                        <SortableNotebookItem
                                            key={entry.EntryID}
                                            entry={entry}
                                            level={0}
                                            onSelect={(id, type) => router.push(`?${type === 'Section' ? 'section' : 'entry'}=${id}`)}
                                            onAddPage={(pid) => onCreateEntry(pid, 'Page')}
                                            onAddSection={(pid) => onCreateEntry(pid, 'Section')}
                                            selectedId={selectedId}
                                            onContextMenu={handleContextMenu}
                                            onRename={handleRename}
                                            onToggleExpand={handleNotebookExpandToggle}
                                        />
                                    ))}
                                </SortableContext>
                                {/* DragOverlay also needs update, passing dummy onRename */}
                                <DragOverlay dropAnimation={dropAnimation}>{activeDragItem ? <SortableNotebookItem entry={activeDragItem} level={0} onSelect={() => { }} onAddPage={() => { }} onAddSection={() => { }} selectedId={null} isOverlay onContextMenu={() => { }} onRename={() => { }} onToggleExpand={() => { }} /> : null}</DragOverlay>
                            </DndContext>
                            {pages.length === 0 && <div className="text-center py-4 text-text-muted text-sm">Empty notebook</div>}
                        </div>
                    </div>
                </>
            )}

            {/* Footer */}
            <div className="p-4 border-t border-border-primary text-xs text-text-muted">
                <span>{type} Mode</span>
            </div>

            {/* Context Menu */}
            {contextMenu.visible && (
                <div
                    className="fixed z-50 bg-bg-card border border-border-primary rounded shadow-xl py-1 min-w-[160px]"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="w-full text-left px-4 py-2 hover:bg-bg-hover text-text-primary text-sm flex items-center"
                        onClick={(e) => {
                            e.stopPropagation();
                            setContextMenu({ ...contextMenu, visible: false });
                            setShowEmojiPicker(true);
                        }}
                    >
                        <span className="mr-2">😊</span> Change Icon
                    </button>
                </div>
            )}

            {/* Emoji Picker Fixed Modal */}
            {showEmojiPicker && (
                <div
                    className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
                    onClick={() => setShowEmojiPicker(false)}
                >
                    <div onClick={e => e.stopPropagation()} className="bg-bg-card rounded-xl shadow-2xl border border-border-primary overflow-hidden">
                        <div className="p-2 border-b border-border-primary flex justify-between items-center bg-bg-active">
                            <span className="text-sm font-semibold pl-2 text-text-primary">Select Icon</span>
                            <button onClick={() => setShowEmojiPicker(false)} className="p-1 hover:bg-red-500/20 hover:text-red-400 rounded text-text-muted"><X size={16} /></button>
                        </div>
                        <EmojiPicker
                            onEmojiClick={(data) => handleIconChange(contextMenu.entryId!, data.emoji)}
                            width={350}
                            height={450}
                            theme={theme === 'dark' ? 'dark' : 'light' as any}
                            searchDisabled={false}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
