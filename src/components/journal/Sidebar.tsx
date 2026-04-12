"use client";

import { ChevronLeft, ChevronRight, Book, FileText, ChevronRight as ChevronRightIcon, Folder, File, GripVertical, X, Trash, ChevronsLeft, ChevronsRight, Lock, LockOpen } from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, addYears, subYears } from 'date-fns';
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
    DropAnimation
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useLoading } from '@/contexts/LoadingContext';
import { type Template } from '@/components/journal/TemplatePicker';

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
const SortableNotebookItem = ({ entry, level, onSelect, onAddPage, onAddFolder, selectedId, isOverlay, onContextMenu, onRename, onToggleExpand, loadingEntryId, loadingProgress }: {
    entry: Entry,
    level: number,
    onSelect: (id: number, type: 'Page' | 'Folder') => void,
    onAddPage: (parentId: number) => void,
    onAddFolder: (parentId: number) => void,
    selectedId: number | null,
    isOverlay?: boolean,
    onContextMenu: (e: React.MouseEvent, entryId: number) => void,
    onRename: (id: number, newTitle: string) => void,
    onToggleExpand: (id: number, expanded: boolean) => void,
    loadingEntryId: number | null,
    loadingProgress: number | null
}) => {
    const [isOpen, setIsOpen] = useState(entry.IsExpanded || false);
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(entry.Title);
    const isSelected = selectedId === entry.EntryID;
    const hasChildren = entry.children && entry.children.length > 0;
    const inputRef = useRef<HTMLInputElement>(null);
    const isLoading = loadingEntryId === entry.EntryID;

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
        if (entry.EntryType === 'Folder') return <Folder className="w-4 h-4 mr-2 text-accent-primary" />;
        return <File className="w-4 h-4 mr-2 text-accent-primary" />;
    };

    if (isOverlay) return (<div className="flex items-center justify-between px-2 py-1.5 rounded bg-bg-card text-text-primary shadow-lg border border-border-primary" style={{ paddingLeft: `${level * 12 + 8}px` }}><div className="flex items-center overflow-hidden"><GripVertical className="w-3 h-3 mr-1 text-text-muted" /><DisplayIcon /><span className="truncate">{entry.Title || 'Untitled'}</span></div></div>);

    return (
        <div ref={setNodeRef} style={style} {...attributes}>
            <div
                className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-sm select-none ${isSelected ? 'bg-accent-primary text-white font-medium' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
                onClick={(e) => {
                    e.stopPropagation();
                    if (entry.EntryType === 'Folder') onSelect(entry.EntryID, 'Folder');
                    else onSelect(entry.EntryID, 'Page');
                }}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (entry.EntryType === 'Folder') {
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
                        className={`mr-1 p-0.5 rounded hover:bg-bg-active cursor-pointer ${entry.EntryType !== 'Folder' && 'invisible'}`}
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
                        <span className="truncate flex-1">{entry.Title || 'Untitled'}</span>
                    )}
                    {entry.IsLocked && !isEditing && (
                        <Lock className={`w-3 h-3 ml-1 flex-shrink-0 ${isSelected ? 'text-white/70' : 'text-text-muted'}`} />
                    )}
                    {/* Loading indicator */}
                    {isLoading && loadingProgress !== null && (
                        <span className="ml-2 text-[10px] text-blue-400 animate-pulse font-medium whitespace-nowrap">
                            {loadingProgress}%
                        </span>
                    )}
                </div>
                <div className="hidden group-hover:flex items-center space-x-1">
                    {entry.EntryType === 'Folder' && (<><button title="Add page" onClick={(e) => { e.stopPropagation(); onAddPage(entry.EntryID); }} className="p-0.5 hover:bg-bg-active rounded text-accent-primary hover:text-accent-primary/80"><File className="w-3 h-3" /></button><button title="Add folder" onClick={(e) => { e.stopPropagation(); onAddFolder(entry.EntryID); }} className="p-0.5 hover:bg-bg-active rounded text-accent-primary hover:text-accent-primary/80"><Folder className="w-3 h-3" /></button></>)}
                </div>
            </div>
            {hasChildren && isOpen && (
                <div className="flex flex-col">
                    <SortableContext items={entry.children!.map(c => c.EntryID)} strategy={verticalListSortingStrategy}>
                        {entry.children!.map(child => (
                            <SortableNotebookItem key={child.EntryID} entry={child} level={level + 1} onSelect={onSelect} onAddPage={onAddPage} onAddFolder={onAddFolder} selectedId={selectedId} onContextMenu={onContextMenu} onRename={onRename} onToggleExpand={onToggleExpand} loadingEntryId={loadingEntryId} loadingProgress={loadingProgress} />
                        ))}
                    </SortableContext>
                </div>
            )}
        </div>
    );
};

// ---------------------------
// Journal Tree Item
// Shares the same visual design as SortableNotebookItem without DnD overhead.
// Used for Year → Month → Entry hierarchy in Journal mode.
// ---------------------------
const JournalTreeItem = ({
    label,
    icon,
    level,
    isSelected,
    isSection,
    isExpanded,
    onToggleExpand,
    onClick,
    onContextMenu,
    children,
}: {
    label: string;
    icon?: string;
    level: number;
    isSelected: boolean;
    isSection: boolean;
    isExpanded: boolean;
    onToggleExpand?: (e: React.MouseEvent) => void;
    onClick: (e: React.MouseEvent) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    children?: React.ReactNode;
}) => {
    const paddingLeft = `${level * 12 + 8}px`;
    return (
        <div>
            <div
                style={{ paddingLeft }}
                className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-sm select-none ${
                    isSelected
                        ? 'bg-accent-primary text-white font-medium'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
                onClick={onClick}
                onContextMenu={onContextMenu}
            >
                <div className="flex items-center overflow-hidden flex-1">
                    {/* Spacer to align with the notebook drag-handle column */}
                    <span className="w-4 mr-1 flex-shrink-0" />

                    {/* Expand / collapse arrow (only for sections) */}
                    <span
                        className={`mr-1 p-0.5 rounded hover:bg-bg-active flex-shrink-0 ${!isSection ? 'invisible' : 'cursor-pointer'}`}
                        onClick={isSection ? onToggleExpand : undefined}
                    >
                        <ChevronRightIcon
                            className={`w-3 h-3 transition-transform text-text-muted ${isExpanded ? 'rotate-90' : ''}`}
                        />
                    </span>

                    {/* Icon */}
                    {icon ? (
                        <span className="mr-2 text-base leading-none flex-shrink-0">{icon}</span>
                    ) : isSection ? (
                        <Folder className={`w-4 h-4 mr-2 flex-shrink-0 ${isSelected ? 'text-white' : 'text-accent-primary'}`} />
                    ) : (
                        <File className={`w-4 h-4 mr-2 flex-shrink-0 ${isSelected ? 'text-white' : 'text-accent-primary'}`} />
                    )}

                    <span className="truncate flex-1">{label}</span>
                </div>
            </div>

            {isSection && isExpanded && children && (
                <div className="flex flex-col">{children}</div>
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
    const { loadingState } = useLoading();

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
                body: JSON.stringify({ isExpanded: expanded })
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
    const urlFolderId = searchParams.get('folder') ? parseInt(searchParams.get('folder')!, 10) : null;

    // Combine for highlighting
    const selectedId = urlEntryId || urlFolderId;

    const [journalEntries, setJournalEntries] = useState<Entry[]>([]);

    const selectedDate = useMemo(() => {
        if (urlDate) {
            const [y, m, d] = urlDate.split('-').map(Number);
            return new Date(y, m - 1, d);
        }
        if (type === 'Journal' && urlEntryId) {
            const entry = journalEntries.find(e => e.EntryID === urlEntryId);
            if (entry && entry.CreatedDate) {
                return new Date(entry.CreatedDate);
            }
        }
        return new Date();
    }, [urlDate, type, urlEntryId, journalEntries]);

    const [currentMonth, setCurrentMonth] = useState(new Date());

    // Notebook Mode
    const [pages, setPages] = useState<Entry[]>([]);
    const [activeDragId, setActiveDragId] = useState<number | null>(null);
    const [activeDragItem, setActiveDragItem] = useState<Entry | null>(null);


    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; entryId: number | null }>({
        visible: false, x: 0, y: 0, entryId: null
    });
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [matchedEntryIds, setMatchedEntryIds] = useState<Set<number> | null>(null);
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        if (!searchQuery.trim()) {
            setMatchedEntryIds(null);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        const controller = new AbortController();

        const timeoutId = setTimeout(async () => {
            try {
                const params = new URLSearchParams({
                    q: searchQuery.trim(),
                    categoryId: categoryId.toString(),
                    limit: '1000'
                });
                const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
                if (res.ok) {
                    const data = await res.json();
                    setMatchedEntryIds(new Set(data.results.map((r: any) => r.EntryID)));
                } else {
                    setMatchedEntryIds(new Set());
                }
            } catch (e: any) {
                if (e.name !== 'AbortError') console.error('Sidebar search failed', e);
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => {
            clearTimeout(timeoutId);
            controller.abort();
        };
    }, [searchQuery, categoryId]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    useEffect(() => {
        if (type === 'Notebook') fetchPages();
        else if (type === 'Journal') fetchJournalEntries();

        let timeoutId: NodeJS.Timeout | null = null;

        const handleUpdate = () => {
            // Immediate fetch (fast)
            if (type === 'Notebook') fetchPages();
            if (type === 'Journal') fetchJournalEntries();

            // Delayed fetch (catch race conditions) - tracked for cleanup
            timeoutId = setTimeout(() => {
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
            if (timeoutId) clearTimeout(timeoutId);
            window.removeEventListener('journal-entry-updated', handleUpdate);
            document.removeEventListener('click', handleClickOutside);
        };
    }, [categoryId, type]);

    // Auto-select entry for notebooks (client-side to avoid flash)
    useEffect(() => {
        if (type !== 'Notebook' || urlEntryId || urlFolderId || pages.length === 0) return;

        const abortController = new AbortController();

        // Helper to find first page in tree
        const findFirstPage = (entries: Entry[]): Entry | null => {
            for (const entry of entries) {
                if (entry.EntryType === 'Page') return entry;
                if (entry.children && entry.children.length > 0) {
                    const found = findFirstPage(entry.children);
                    if (found) return found;
                }
            }
            return null;
        };

        // Helper to check if entry exists in tree
        const findEntryById = (id: number, entries: Entry[]): boolean => {
            for (const entry of entries) {
                if (entry.EntryID === id) return true;
                if (entry.children && findEntryById(id, entry.children)) return true;
            }
            return false;
        };

        // Try to load last selected from ViewSettings
        fetch(`/api/category/${categoryId}`, { signal: abortController.signal })
            .then(res => res.json())
            .then(data => {
                if (abortController.signal.aborted) return;

                let targetId: number | null = null;

                // Get from ViewSettings
                try {
                    const viewSettings = data.ViewSettings ? JSON.parse(data.ViewSettings) : {};
                    targetId = viewSettings.lastSelectedEntryId;

                    // Verify entry still exists
                    if (targetId && !findEntryById(targetId, pages)) {
                        targetId = null;
                    }
                } catch { /* ignore */ }

                // Fallback to first page
                if (!targetId) {
                    const firstPage = findFirstPage(pages);
                    targetId = firstPage?.EntryID || null;
                }

                if (targetId) {
                    router.push(`?entry=${targetId}`, { scroll: false });
                }
            })
            .catch(() => { /* silent fail or aborted */ });

        return () => abortController.abort();
    }, [type, urlEntryId, urlFolderId, pages, categoryId, router]);

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
            if (Array.isArray(data)) setJournalEntries(data as Entry[]);
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
            body: JSON.stringify({ icon })
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
                body: JSON.stringify({ title: newTitle })
            }); // Optimistic update possible, but fetching is safer
            if (type === 'Notebook') fetchPages();
            else fetchJournalEntries();
        } catch (e) { /* silence */ }
    };

    const handleToggleLock = async (id: number, currentlyLocked: boolean) => {
        try {
            await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isLocked: !currentlyLocked })
            });
            if (type === 'Notebook') fetchPages();
            else fetchJournalEntries();
        } catch (e) { /* silence */ }
        setContextMenu(prev => ({ ...prev, visible: false }));
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this entry? This cannot be undone.")) return;
        try {
            const res = await fetch(`/api/entry/${id}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                if (type === 'Notebook') fetchPages();
                else fetchJournalEntries();
                setContextMenu(prev => ({ ...prev, visible: false }));
            } else {
                alert("Failed to delete entry. Your data is safe.");
            }
        } catch (e) {
            alert("Failed to delete entry. Your data is safe.");
        }
    };

    // ... (Date/Journal Logic same as before)
    const onDateClick = (day: Date) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        router.push(`?date=${dateStr}`);
    };
    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
    const nextYear = () => setCurrentMonth(addYears(currentMonth, 1));
    const prevYear = () => setCurrentMonth(subYears(currentMonth, 1));

    const filteredJournalEntries = useMemo(() => {
        if (matchedEntryIds === null) return journalEntries;
        return journalEntries.filter(e => matchedEntryIds.has(e.EntryID));
    }, [journalEntries, matchedEntryIds]);

    const groupedEntries = filteredJournalEntries.reduce((acc: Record<string, Record<string, { entries: Entry[], key: string }>>, entry: Entry) => {
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

    const createEntryWithContent = async (parentId: number | null, entryType: 'Page' | 'Folder', template?: Template | null) => {
        const res = await fetch('/api/entry/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryId,
                title: entryType === 'Folder' ? 'New Folder' : (template?.Name ?? 'Untitled Page'),
                parentEntryId: parentId,
                entryType,
                templateId: template?.TemplateID ?? null,
            })
        });
        const newEntry = await res.json();
        if (!res.ok) {
            console.error('Failed to create entry:', newEntry);
            return;
        }
        fetchPages();
        if (entryType === 'Page' && newEntry.id) {
            router.push(`?entry=${newEntry.id}`);
        }
    };

    const onCreateEntry = (parentId: number | null, entryType: 'Page' | 'Folder') => {
        if (entryType === 'Folder') {
            // Folders never use templates
            createEntryWithContent(parentId, 'Folder');
        } else {
            // Create new page immediately without template prompt
            createEntryWithContent(parentId, 'Page');
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
        if (overItem.EntryType === 'Folder') { newParentId = overItem.EntryID; newSortOrder = (overItem.children?.length || 0) + 1; }
        try {
            await fetch('/api/entry/move', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: activeId, parentId: newParentId, sortOrder: newSortOrder }) });
            fetchPages();
        } catch (err) { /* silence */ }
    };
    const filteredPages = useMemo(() => {
        if (matchedEntryIds === null) return pages;

        const filterTree = (nodes: Entry[]): Entry[] => {
            return nodes.reduce<Entry[]>((acc, node) => {
                const matchesSelf = matchedEntryIds.has(node.EntryID);
                const filteredChildren = node.children ? filterTree(node.children) : [];

                // If it matches itself or has matching children, include it
                if (matchesSelf || filteredChildren.length > 0) {
                    // Force expand if it matched something inside to make it visible
                    const forceExpand = matchedEntryIds !== null && (matchesSelf || filteredChildren.length > 0);
                    acc.push({ ...node, children: filteredChildren, IsExpanded: forceExpand ? true : node.IsExpanded });
                }
                return acc;
            }, []);
        };

        return filterTree(pages);
    }, [pages, matchedEntryIds]);

    const rootIds = useMemo(() => filteredPages.map(p => p.EntryID), [filteredPages]);
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
            <div className="flex-shrink-0 p-4 flex items-center justify-between border-b border-border-primary">
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
                    <div className="flex-shrink-0 p-4 border-b border-border-primary">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold text-text-primary">{format(currentMonth, 'MMMM yyyy')}</h3>
                            <div className="flex space-x-1">
                                <button onClick={prevYear} className="p-1 hover:bg-bg-hover rounded text-accent-primary hover:text-accent-primary/80"><ChevronsLeft className="w-4 h-4" /></button>
                                <button onClick={prevMonth} className="p-1 hover:bg-bg-hover rounded text-accent-primary hover:text-accent-primary/80"><ChevronLeft className="w-4 h-4" /></button>
                                <button onClick={nextMonth} className="p-1 hover:bg-bg-hover rounded text-accent-primary hover:text-accent-primary/80"><ChevronRight className="w-4 h-4" /></button>
                                <button onClick={nextYear} className="p-1 hover:bg-bg-hover rounded text-accent-primary hover:text-accent-primary/80"><ChevronsRight className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-muted mb-2"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
                        <div className="grid grid-cols-7 gap-1 text-sm">
                            {calendarDays.map((day, i) => {
                                const isSelected = isSameDay(day, selectedDate);
                                const isCurrentMonth = isSameMonth(day, currentMonth);
                                const entryForDay = journalEntries.find(e => e.CreatedDate && isSameDay(new Date(e.CreatedDate), day));
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
                    {/* Journal Tree — uses the same JournalTreeItem visual as the notebook tree */}
                    <div className="flex-1 overflow-y-auto p-2 pb-16 min-h-0 space-y-0.5">
                        {Object.keys(groupedEntries).sort((a, b) => b.localeCompare(a)).map(year => {
                            const isYearOpen = journalExpanded[year] !== false;
                            return (
                                <JournalTreeItem
                                    key={year}
                                    label={year}
                                    level={0}
                                    isSelected={false}
                                    isSection={true}
                                    isExpanded={isYearOpen}
                                    onToggleExpand={(e) => { e.stopPropagation(); toggleJournalNode(year); }}
                                    onClick={() => router.push(`?year=${year}`)}
                                >
                                    {Object.keys(groupedEntries[year]).map(month => {
                                        const monthKey = groupedEntries[year][month].key;
                                        const isMonthOpen = journalExpanded[monthKey] !== false;
                                        return (
                                            <JournalTreeItem
                                                key={month}
                                                label={month}
                                                level={1}
                                                isSelected={false}
                                                isSection={true}
                                                isExpanded={isMonthOpen}
                                                onToggleExpand={(e) => { e.stopPropagation(); toggleJournalNode(monthKey); }}
                                                onClick={() => router.push(`?month=${monthKey}`)}
                                            >
                                                {groupedEntries[year][month].entries
                                                    .sort((a: Entry, b: Entry) =>
                                                        new Date(a.CreatedDate!).getTime() - new Date(b.CreatedDate!).getTime()
                                                    )
                                                    .map((entry: Entry) => {
                                                        const isSelected = isSameDay(new Date(entry.CreatedDate!), selectedDate);
                                                        const dateLabel = `${format(new Date(entry.CreatedDate!), 'd')} (${format(new Date(entry.CreatedDate!), 'EEE')})${entry.Title && entry.Title !== 'Untitled' ? ` - ${entry.Title}` : ''}`;
                                                        return (
                                                            <JournalTreeItem
                                                                key={entry.EntryID}
                                                                label={dateLabel}
                                                                icon={entry.Icon}
                                                                level={2}
                                                                isSelected={isSelected}
                                                                isSection={false}
                                                                isExpanded={false}
                                                                onClick={() => onDateClick(new Date(entry.CreatedDate!))}
                                                                onContextMenu={(e) => handleContextMenu(e, entry.EntryID)}
                                                            />
                                                        );
                                                    })}
                                            </JournalTreeItem>
                                        );
                                    })}
                                </JournalTreeItem>
                            );
                        })}
                    </div>
                </>
            ) : (
                <>
                    {/* Notebook Tree */}
                    <div className="flex-1 overflow-y-auto p-2 pb-20 min-h-0">
                        <div className="flex items-center justify-between px-2 mb-2">
                            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Notebook</span>
                            <div className="flex space-x-1">
                            <button title="New page" onClick={() => onCreateEntry(null, 'Page')} className="p-1 hover:bg-bg-hover rounded text-accent-primary hover:text-accent-primary/80"><File className="w-3 h-3" /></button>
                                <button title="New folder" onClick={() => onCreateEntry(null, 'Folder')} className="p-1 hover:bg-bg-hover rounded text-accent-primary hover:text-accent-primary/80"><Folder className="w-3 h-3" /></button>
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                                <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
                                    {filteredPages.map(entry => (
                                        <SortableNotebookItem
                                            key={entry.EntryID}
                                            entry={entry}
                                            level={0}
                                            onSelect={async (id, type) => {
                                                router.push(`?${type === 'Folder' ? 'folder' : 'entry'}=${id}`);

                                                // Save last selected entry for notebooks
                                                if (type === 'Page') {
                                                    try {
                                                        await fetch(`/api/category/${categoryId}`, {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ lastSelectedEntryId: id })
                                                        });
                                                    } catch { /* silent fail */ }
                                                }
                                            }}
                                            onAddPage={(pid) => onCreateEntry(pid, 'Page')}
                                            onAddFolder={(pid) => onCreateEntry(pid, 'Folder')}
                                            selectedId={selectedId}
                                            onContextMenu={handleContextMenu}
                                            onRename={handleRename}
                                            onToggleExpand={handleNotebookExpandToggle}
                                            loadingEntryId={loadingState.entryId}
                                            loadingProgress={loadingState.progress}
                                        />
                                    ))}
                                </SortableContext>
                                {/* DragOverlay also needs update, passing dummy onRename */}
                                <DragOverlay dropAnimation={dropAnimation}>{activeDragItem ? <SortableNotebookItem entry={activeDragItem} level={0} onSelect={() => { }} onAddPage={() => { }} onAddFolder={() => { }} selectedId={null} isOverlay onContextMenu={() => { }} onRename={() => { }} onToggleExpand={() => { }} loadingEntryId={null} loadingProgress={null} /> : null}</DragOverlay>
                            </DndContext>
                            {filteredPages.length === 0 && <div className="text-center py-4 text-text-muted text-sm">{searchQuery ? 'No matches found' : 'Empty notebook'}</div>}
                        </div>
                    </div>
                </>
            )
            }

            {/* Search Bar Footer */}
            <div className="absolute bottom-0 w-full p-3 border-t border-border-primary bg-bg-sidebar z-[100]">
                <div className="relative">
                    <input
                        type="text"
                        placeholder={`Search ${type.toLowerCase()}...`}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full bg-bg-active text-text-primary pl-8 pr-3 py-1.5 rounded-lg border border-border-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary text-sm transition-all text-ellipsis"
                    />
                    {isSearching ? (
                        <div className="w-3.5 h-3.5 absolute left-3 top-2.5 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin pointer-events-none" />
                    ) : (
                        <svg className="w-4 h-4 absolute left-2.5 top-2.5 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" strokeWidth={2} /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35" /></svg>
                    )}
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="absolute right-2 top-2 p-0.5 rounded-full hover:bg-bg-hover text-text-muted hover:text-text-primary">
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* Context Menu */}
            {
                contextMenu.visible && (() => {
                    const findEntry = (id: number, items: Entry[]): Entry | null => {
                        for (const item of items) {
                            if (item.EntryID === id) return item;
                            if (item.children) { const f = findEntry(id, item.children); if (f) return f; }
                        }
                        return null;
                    };
                    const ctxEntry = type === 'Notebook'
                        ? findEntry(contextMenu.entryId!, pages)
                        : journalEntries.find(e => e.EntryID === contextMenu.entryId!) ?? null;
                    const isLocked = ctxEntry?.IsLocked ?? false;

                    return (
                        <div
                            className="fixed z-50 bg-bg-card border border-border-primary rounded shadow-xl py-1 min-w-[160px]"
                            style={{ top: contextMenu.y, left: contextMenu.x }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                className="w-full text-left px-4 py-2 hover:bg-bg-hover text-text-primary text-sm flex items-center"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleLock(contextMenu.entryId!, isLocked);
                                }}
                            >
                                {isLocked
                                    ? <><LockOpen className="w-4 h-4 mr-2" /> Unlock</>
                                    : <><Lock className="w-4 h-4 mr-2" /> Lock</>
                                }
                            </button>
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
                            <div className="mx-3 my-1 border-t border-border-primary" />
                            <button
                                className="w-full text-left px-4 py-2 hover:bg-bg-hover text-text-primary text-sm flex items-center hover:text-red-500"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(contextMenu.entryId!);
                                }}
                            >
                                <Trash className="w-4 h-4 mr-2" /> Delete
                            </button>
                        </div>
                    );
                })()
            }


            {/* Emoji Picker Fixed Modal */}
            {
                showEmojiPicker && (
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
                )
            }
        </div >
    );
}
