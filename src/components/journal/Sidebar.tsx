"use client";

import { ChevronLeft, ChevronRight, Search, Menu, Settings, Book, FileText, ChevronDown, ChevronRight as ChevronRightIcon, Plus, Folder, File, GripVertical, X } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
}

interface Entry {
    EntryID: number;
    Title: string;
    ParentEntryID: number | null;
    EntryType: 'Page' | 'Section';
    SortOrder: number;
    Icon?: string;
    children?: Entry[];
}

// ---------------------------
// Sortable Notebook Item
// ---------------------------
const SortableNotebookItem = ({ entry, level, onSelect, onAddPage, onAddSection, selectedId, isOverlay, onContextMenu }: {
    entry: Entry,
    level: number,
    onSelect: (id: number) => void,
    onAddPage: (parentId: number) => void,
    onAddSection: (parentId: number) => void,
    selectedId: number | null,
    isOverlay?: boolean,
    onContextMenu: (e: React.MouseEvent, entryId: number) => void
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
        id: entry.EntryID,
        data: { type: 'Entry', entry }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        paddingLeft: `${level * 12 + 8}px`,
        opacity: isDragging ? 0.3 : 1,
    };

    const DisplayIcon = () => {
        if (entry.Icon) return <span className="mr-2 text-base leading-none">{entry.Icon}</span>;
        if (entry.EntryType === 'Section') return <Folder className="w-4 h-4 mr-2 text-yellow-500" />;
        return <File className="w-4 h-4 mr-2 text-blue-400" />;
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
                    <DisplayIcon />
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
                    if (entry.EntryType === 'Section') setIsOpen(!isOpen);
                    else onSelect(entry.EntryID);
                }}
                onContextMenu={(e) => onContextMenu(e, entry.EntryID)}
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

                    <DisplayIcon />
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
                    <SortableContext items={entry.children!.map(c => c.EntryID)} strategy={verticalListSortingStrategy}>
                        {entry.children!.map(child => (
                            <SortableNotebookItem
                                key={child.EntryID}
                                entry={child}
                                level={level + 1}
                                onSelect={onSelect}
                                onAddPage={onAddPage}
                                onAddSection={onAddSection}
                                selectedId={selectedId}
                                onContextMenu={onContextMenu}
                            />
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
export default function Sidebar({ categoryId, userId, title, type }: SidebarProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Journal Mode
    const urlDate = searchParams.get('date');
    const urlEntryId = searchParams.get('entry') ? parseInt(searchParams.get('entry')!, 10) : null;
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
            if (type === 'Notebook') fetchPages();
            if (type === 'Journal') fetchJournalEntries();
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
            const res = await fetch(`/api/entry?categoryId=${categoryId}`);
            const data = await res.json();
            if (Array.isArray(data)) setPages(buildTree(data));
        } catch (e) { console.error(e); }
    };

    const buildTree = (entries: any[]) => {
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
        } catch (e) { console.error(e); }
    };

    const handleContextMenu = (e: React.MouseEvent, entryId: number) => {
        e.preventDefault();
        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, entryId });
        setShowEmojiPicker(false);
    };

    const handleIconChange = async (entryId: number, icon: string) => {
        console.log("Changing icon for", entryId, "to", icon, "User:", userId);
        const res = await fetch(`/api/entry/${entryId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icon: icon, userId })
        });
        console.log("Icon update response:", res.status);
        if (type === 'Journal') fetchJournalEntries();
        else fetchPages();

        setContextMenu(prev => ({ ...prev, visible: false }));
        setShowEmojiPicker(false);
    };

    // ... (Date/Journal Logic same as before)
    const onDateClick = (day: Date) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        router.push(`?date=${dateStr}`);
    };
    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

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
        } catch (err) { console.error(err); }
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
        <div className="w-80 bg-gray-950 border-r border-gray-800 flex flex-col h-full flex-shrink-0 relative">
            {/* Header */}
            <div className="p-4 flex items-center justify-between border-b border-gray-800">
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
                        {type === 'Journal' ? <Book className="text-white w-4 h-4" /> : <FileText className="text-white w-4 h-4" />}
                    </div>
                    <span className="font-medium truncate max-w-[150px]">{title}</span>
                </div>
                <Link href="/dashboard" className="p-1 hover:bg-gray-800 rounded"><ChevronLeft className="w-5 h-5 text-gray-400" /></Link>
            </div>

            {/* Content Switcher */}
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
                        <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-2"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
                        <div className="grid grid-cols-7 gap-1 text-sm">
                            {calendarDays.map((day, i) => {
                                const isSelected = isSameDay(day, selectedDate);
                                const isCurrentMonth = isSameMonth(day, currentMonth);
                                const entryForDay = journalEntries.find(e => isSameDay(new Date(e.CreatedDate), day));
                                return (
                                    <div
                                        key={i}
                                        onClick={() => onDateClick(day)}
                                        className={`p-1 rounded cursor-pointer flex items-center justify-center h-8 w-8 mx-auto ${!isCurrentMonth ? 'text-gray-700' : ''} ${isSelected ? 'bg-blue-600 text-white font-bold' : 'hover:bg-gray-800 text-gray-400'}`}
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
                        {Object.keys(groupedEntries).sort((a, b) => a.localeCompare(b)).map(year => (
                            <details key={year} open className="group mb-2">
                                <summary className="flex items-center cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 px-2 mt-2 select-none hover:text-gray-300 outline-none">
                                    <span className="mr-1 group-open:rotate-90 transition-transform text-gray-600 inline-block w-3">▸</span>{year}
                                </summary>
                                {Object.keys(groupedEntries[year]).map(month => (
                                    <div key={month} className="pl-2">
                                        <details open className="group/month">
                                            <summary className="flex items-center cursor-pointer text-sm text-gray-400 hover:text-white py-1 px-2 rounded hover:bg-gray-800 select-none outline-none">
                                                <span className="mr-2 text-[10px] group-open/month:rotate-90 transition-transform inline-block w-3 text-gray-500">▸</span>{month}
                                            </summary>
                                            <div className="pl-6 space-y-0.5 mt-1 border-l border-gray-800 ml-3">
                                                {groupedEntries[year][month].sort((a: any, b: any) => new Date(a.CreatedDate).getTime() - new Date(b.CreatedDate).getTime()).map((entry: any) => {
                                                    const displayTitle = entry.Title && entry.Title !== 'Untitled' ? ` - ${entry.Title}` : '';
                                                    return (
                                                        <div
                                                            key={entry.EntryID}
                                                            onClick={() => onDateClick(new Date(entry.CreatedDate))}
                                                            onContextMenu={(e) => handleContextMenu(e, entry.EntryID)}
                                                            className={`px-2 py-1 rounded cursor-pointer text-sm truncate transition-colors flex items-center ${isSameDay(new Date(entry.CreatedDate), selectedDate) ? 'bg-purple-900/40 text-purple-200' : 'text-gray-400 hover:bg-gray-800'}`}
                                                        >
                                                            {entry.Icon && <span className="mr-2 text-xs">{entry.Icon}</span>}
                                                            <span className="truncate">
                                                                {format(new Date(entry.CreatedDate), 'd')} ({format(new Date(entry.CreatedDate), 'EEE')}){displayTitle}
                                                            </span>
                                                        </div>
                                                    )
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
                    {/* Notebook Tree */}
                    <div className="flex-1 overflow-y-auto p-2 pb-20">
                        <div className="flex items-center justify-between px-2 mb-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Notebook</span>
                            <div className="flex space-x-1">
                                <button onClick={() => onCreateEntry(null, 'Page')} className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white"><File className="w-3 h-3" /></button>
                                <button onClick={() => onCreateEntry(null, 'Section')} className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white"><Folder className="w-3 h-3" /></button>
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                                <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
                                    {pages.map(entry => (
                                        <SortableNotebookItem key={entry.EntryID} entry={entry} level={0} onSelect={(id) => router.push(`?entry=${id}`)} onAddPage={(pid) => onCreateEntry(pid, 'Page')} onAddSection={(pid) => onCreateEntry(pid, 'Section')} selectedId={urlEntryId} onContextMenu={handleContextMenu} />
                                    ))}
                                </SortableContext>
                                <DragOverlay dropAnimation={dropAnimation}>
                                    {activeDragItem ? <SortableNotebookItem entry={activeDragItem} level={0} onSelect={() => { }} onAddPage={() => { }} onAddSection={() => { }} selectedId={null} isOverlay onContextMenu={() => { }} /> : null}
                                </DragOverlay>
                            </DndContext>
                            {pages.length === 0 && <div className="text-center py-4 text-gray-600 text-sm">Empty notebook</div>}
                        </div>
                    </div>
                </>
            )}

            {/* Footer */}
            <div className="p-4 border-t border-gray-800 text-xs text-gray-500">
                <span>{type} Mode</span>
            </div>

            {/* Context Menu */}
            {contextMenu.visible && (
                <div
                    className="fixed z-50 bg-[#2d2d2d] border border-[#444] rounded shadow-xl py-1 min-w-[160px]"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="w-full text-left px-4 py-2 hover:bg-[#3d3d3d] text-gray-200 text-sm flex items-center"
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
                    <div onClick={e => e.stopPropagation()} className="bg-[#2d2d2d] rounded-xl shadow-2xl border border-gray-700 overflow-hidden">
                        <div className="p-2 border-b border-gray-700 flex justify-between items-center bg-[#252525]">
                            <span className="text-sm font-semibold pl-2">Select Icon</span>
                            <button onClick={() => setShowEmojiPicker(false)} className="p-1 hover:bg-red-500/20 hover:text-red-400 rounded"><X size={16} /></button>
                        </div>
                        <EmojiPicker
                            onEmojiClick={(data) => handleIconChange(contextMenu.entryId!, data.emoji)}
                            width={350}
                            height={450}
                            theme={"dark" as any}
                            searchDisabled={false}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
