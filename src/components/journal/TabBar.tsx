"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { X, Plus, Book, FileText, LogOut, Settings, Trash, Bell, Target, BarChart3, Replace, Calendar, Cloud, Wand2, HelpCircle, Keyboard, FileQuestion, Bug } from 'lucide-react';
import TrashPanel from './TrashPanel';
import RemindersPanel from './RemindersPanel';
import GoalsPanel from './GoalsPanel';
import StatsPanel from './StatsPanel';
import ReplacePanel from './ReplacePanel';
import OnThisDayPanel from './OnThisDayPanel';
import WordCloudPanel from './WordCloudPanel';
import SnippetsPanel from './SnippetsPanel';
import FavoritesPanel from './FavoritesPanel';
import HabitsPanel from './HabitsPanel';
import CategorySettingsModal from './CategorySettingsModal';
import CategoryTree from './CategoryTree';
import { Scissors } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Theme as EmojiTheme } from 'emoji-picker-react';
import { useClickOutside } from '@/hooks';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    horizontalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Dynamic import for Emoji Picker
const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

import { Category } from '@/lib/types';
import { logout } from '@/app/actions';

// ---------------------------
// Sortable Tab Component
// ---------------------------
function TabIcon({ category }: { category: Category }) {
    if (category.Icon) return <span className="mr-2 text-base leading-none">{category.Icon}</span>;
    return category.Type === 'Notebook'
        ? <FileText size={14} className="mr-2 text-accent-primary" />
        : <Book size={14} className="mr-2 text-accent-primary" />;
}

interface SortableTabProps {
    category: Category;
    isActive: boolean;
    onClick: () => void;
    onDelete: (id: number) => void;
    onRename: (id: number, name: string) => void;
    onIconChange: (id: number, icon: string) => void;
    onColorChange: (id: number, color: string) => void;
    onOpenSettings: (id: number) => void;
}

const PRESET_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
    '#f97316', '#eab308', '#22c55e', '#14b8a6',
    '#0ea5e9', '#64748b', '#a855f7', '#06b6d4',
];

function SortableTab({ category, isActive, onClick, onDelete, onRename, onIconChange, onColorChange, onOpenSettings }: SortableTabProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: category.CategoryID });

    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(category.Name);
    const [showPicker, setShowPicker] = useState(false);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);
    const colorPickerRef = useRef<HTMLDivElement>(null);
    const { theme } = useTheme();

    useClickOutside(colorPickerRef, () => setShowColorPicker(false), showColorPicker);
    useClickOutside(pickerRef, () => setShowPicker(false), showPicker);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSave();
    };

    const handleSave = () => {
        setIsEditing(false);
        if (editName.trim() !== category.Name) {
            onRename(category.CategoryID, editName);
        }
    };

    const togglePicker = (e: React.MouseEvent) => {
        if (!isActive) return;
        e.stopPropagation();
        setShowPicker(!showPicker);
    }

    const onEmojiClick = (emojiData: { emoji: string }, event: MouseEvent) => {
        event.stopPropagation();
        onIconChange(category.CategoryID, emojiData.emoji);
        setShowPicker(false);
    }

    if (isEditing) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className={`
                    group flex items-center gap-2 px-3 py-1 min-w-[120px] max-w-[200px] h-[38px] rounded-t-lg text-sm font-medium transition-all select-none
                    ${isActive
                        ? 'bg-bg-sidebar text-text-primary border-t-2 border-x-2 border-accent-primary translate-y-[2px] z-10'
                        : 'bg-transparent text-text-muted hover:text-text-secondary'
                    }
                `}
            >
                <TabIcon category={category} />
                <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSave}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent border-none outline-none w-full min-w-0 text-text-primary"
                />
            </div>
        )
    }

    return (
        <div
            ref={setNodeRef}
            style={{
                ...style,
                ...(isActive ? { borderColor: category.Color || 'var(--color-accent-primary)' } : {}),
            }}
            {...attributes}
            {...listeners}
            onClick={onClick}
            onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
            }}
            className={`
                relative group flex items-center min-w-[120px] max-w-[200px] h-[38px] px-3 rounded-t-lg text-sm cursor-pointer select-none transition-colors
                ${isActive
                    ? 'bg-bg-sidebar text-text-primary border-t-2 border-x-2 translate-y-[2px] z-10'
                    : 'bg-transparent text-text-muted hover:text-text-secondary'
                }
            `}
        >
            <div onClick={togglePicker} className="hover:bg-bg-active/50 rounded p-0.5 cursor-pointer flex items-center justify-center">
                <TabIcon category={category} />
            </div>

            <span className="truncate flex-1">{category.Name}</span>

            {/* Color swatch — click to open color picker (only on active tab) */}
            {isActive && (
                <div className="relative ml-1" ref={colorPickerRef}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowColorPicker(v => !v); }}
                        className="w-3.5 h-3.5 rounded-full border border-white/30 flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                        style={{ background: category.Color || '#6366f1' }}
                        title="Change color"
                    />
                    {showColorPicker && (
                        <div
                            className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-[200] bg-bg-card border border-border-primary rounded-xl shadow-2xl p-3 w-max"
                            onClick={e => e.stopPropagation()}
                        >
                            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-2 font-semibold">Tab color</p>
                            <div className="grid grid-cols-6 gap-1.5">
                                {PRESET_COLORS.map(c => (
                                    <button
                                        key={c}
                                        onClick={() => { onColorChange(category.CategoryID, c); setShowColorPicker(false); }}
                                        className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                                        style={{
                                            background: c,
                                            borderColor: (category.Color || '#6366f1') === c ? 'white' : 'transparent',
                                        }}
                                        title={c}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {isActive && (
                <button
                    onClick={(e) => { e.stopPropagation(); onOpenSettings(category.CategoryID); }}
                    className="p-0.5 rounded hover:bg-bg-active text-text-muted hover:text-text-primary opacity-70 hover:opacity-100 transition-opacity ml-1"
                    title="Category settings"
                >
                    <Settings size={12} />
                </button>
            )}

            {category.IsSmartbook && (
                <span title="Smartbook (auto-collected)" className="ml-1 text-accent-primary opacity-80">
                    <Wand2 size={12} />
                </span>
            )}

            <button
                onClick={(e) => { e.stopPropagation(); onDelete(category.CategoryID); }}
                className={`p-0.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1`}
            >
                <X size={12} />
            </button>

            {/* Modal Portal for Emoji Picker */}
            {showPicker && typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 cursor-default"
                    onMouseDown={(e) => { e.stopPropagation(); setShowPicker(false); }}
                >
                    <div
                        className="bg-bg-card rounded-xl shadow-2xl border border-border-primary overflow-hidden"
                        onMouseDown={e => e.stopPropagation()}
                    >
                        <div className="p-2 border-b border-border-primary flex justify-between items-center bg-bg-active">
                            <span className="text-sm font-semibold pl-2 text-text-primary">Select Icon</span>
                            <button onClick={() => setShowPicker(false)} className="p-1 hover:bg-red-500/20 hover:text-red-400 rounded text-text-muted"><X size={16} /></button>
                        </div>
                        <EmojiPicker
                            onEmojiClick={onEmojiClick}
                            width={350}
                            height={450}
                            theme={theme === 'dark' ? EmojiTheme.DARK : EmojiTheme.LIGHT}
                        />
                    </div>
                </div>, document.body
            )}
        </div>
    );
}

// ---------------------------
// Main TabBar Container
// ---------------------------
export default function TabBar({ userId }: { userId: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const { setTheme, theme } = useTheme();
    const [tabs, setTabs] = useState<Category[]>([]);

    // UI State
    const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
    const [newTabName, setNewTabName] = useState('');
    const [newTabType, setNewTabType] = useState<'Journal' | 'Notebook'>('Journal');
    const [newTabIsSmartbook, setNewTabIsSmartbook] = useState(false);
    // When adding a sub-category from the tree, the new category's parent.
    const [pendingParentId, setPendingParentId] = useState<number | null>(null);
    const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
    const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
    const [isTrashOpen, setIsTrashOpen] = useState(false);
    const [isRemindersOpen, setIsRemindersOpen] = useState(false);
    const [isGoalsOpen, setIsGoalsOpen] = useState(false);
    const [isStatsOpen, setIsStatsOpen] = useState(false);
    const [isReplaceOpen, setIsReplaceOpen] = useState(false);
    const [isOnThisDayOpen, setIsOnThisDayOpen] = useState(false);
    const [isWordCloudOpen, setIsWordCloudOpen] = useState(false);
    const [isSnippetsOpen, setIsSnippetsOpen] = useState(false);
    const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
    const [isHabitsOpen, setIsHabitsOpen] = useState(false);
    const [settingsCategoryId, setSettingsCategoryId] = useState<number | null>(null);
    const [isClient, setIsClient] = useState(false);
    const [mainToolbarHidden, setMainToolbarHidden] = useState(false);
    const [tabsPosition, setTabsPosition] = useState<'top' | 'bottom' | 'vertical'>('top');
    useEffect(() => setIsClient(true), []);

    // Refs for clicking outside
    const fileInputRef = useRef<HTMLInputElement>(null);
    const fileMenuRef = useRef<HTMLDivElement>(null);
    const viewMenuRef = useRef<HTMLDivElement>(null);
    const importEntriesInputRef = useRef<HTMLInputElement>(null);

    const handleLogout = useCallback(async () => {
        if (window.electron) {
            await window.electron.logout();
        }
        await logout();
    }, []);

    const handleExportClick = useCallback(() => {
        window.open('/api/backup/export', '_blank');
        setIsFileMenuOpen(false);
    }, []);

    // Initial data load
    useEffect(() => {
        let isMounted = true;

        const loadTabs = async () => {
            try {
                const res = await fetch('/api/category');
                const data = await res.json();
                if (isMounted && Array.isArray(data)) {
                    const sorted = data.sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
                    setTabs(sorted);
                }
            } catch {
                // noop
            }
        };

        loadTabs();
        return () => {
            isMounted = false;
        };
    }, []);

    // Open the Find & Replace panel on Ctrl+H (David RM Replace).
    useEffect(() => {
        const onReplace = () => setIsReplaceOpen(true);
        window.addEventListener('trigger-replace', onReplace);
        return () => window.removeEventListener('trigger-replace', onReplace);
    }, []);

    // Click away handlers using custom hook
    const closeFileMenu = useCallback(() => setIsFileMenuOpen(false), []);
    const closeViewMenu = useCallback(() => setIsViewMenuOpen(false), []);
    const dispatchViewAction = useCallback((action: string) => {
        window.dispatchEvent(new CustomEvent(`trigger-${action}`));
    }, []);
    useClickOutside(fileMenuRef, closeFileMenu, isFileMenuOpen);
    useClickOutside(viewMenuRef, closeViewMenu, isViewMenuOpen);

    // Drag and Drop Sensors
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    // Handlers
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = tabs.findIndex(c => c.CategoryID === active.id);
            const newIndex = tabs.findIndex(c => c.CategoryID === over.id);
            // The list can change between drag-start and drag-end (e.g. a
            // journal-entry-updated refetch); a stale id → -1 would corrupt order.
            if (oldIndex < 0 || newIndex < 0) return;

            const newTabs = arrayMove(tabs, oldIndex, newIndex);
            setTabs(newTabs); // Optimistic

            // Persist Order
            const updates = newTabs.map((cat, index) => ({
                id: cat.CategoryID,
                sortOrder: index
            }));

            fetch('/api/category/reorder', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates })
            }).catch(() => { /* silence */ });
        }
    };

    // Drag-to-nest in the vertical tree: optimistically re-parent, then persist.
    // The server re-validates ownership + cycle safety (PUT /api/category/[id]).
    const handleReparent = async (id: number, parentId: number | null) => {
        const prev = tabs;
        setTabs(prev.map(c => c.CategoryID === id ? { ...c, ParentCategoryID: parentId } : c));
        try {
            const res = await fetch(`/api/category/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentCategoryId: parentId }),
            });
            if (!res.ok) setTabs(prev); // server rejected (cycle/ownership) — revert
        } catch {
            setTabs(prev);
        }
    };

    const handleRename = async (id: number, newName: string) => {
        setTabs(prev => prev.map(c => c.CategoryID === id ? { ...c, Name: newName } : c));
        await fetch(`/api/category/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
    };

    const handleIconChange = async (id: number, newIcon: string) => {
        setTabs(prev => prev.map(c => c.CategoryID === id ? { ...c, Icon: newIcon } : c));
        await fetch(`/api/category/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icon: newIcon })
        });
    };

    const handleColorChange = async (id: number, newColor: string) => {
        setTabs(prev => prev.map(c => c.CategoryID === id ? { ...c, Color: newColor } : c));
        await fetch(`/api/category/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color: newColor })
        });
    };

    const handleCreateTab = async () => {
        try {
            const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
            const body: Record<string, unknown> = {
                name: newTabName, type: newTabType, userId, color: randomColor,
            };
            if (newTabIsSmartbook) {
                body.isSmartbook = true;
                body.smartbookQuery = JSON.stringify({});
            }
            if (pendingParentId != null) body.parentCategoryId = pendingParentId;
            const res = await fetch('/api/category', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const newCat = await res.json();
            if (newCat.id) {
                setTabs([...tabs, {
                    CategoryID: newCat.id, Name: newTabName, Type: newTabType,
                    Color: randomColor, SortOrder: tabs.length,
                    ParentCategoryID: pendingParentId,
                    IsSmartbook: newTabIsSmartbook || false,
                }]);
                setIsAddMenuOpen(false);
                setNewTabName('');
                setNewTabIsSmartbook(false);
                setPendingParentId(null);
                router.push(`/journal/${newCat.id}`);
                // If user created a Smartbook, open the settings modal so they
                // can configure the query immediately — an empty smartbook is
                // useless and the editor presents poorly without one.
                if (newTabIsSmartbook) {
                    setSettingsCategoryId(newCat.id);
                }
            }
        } catch { /* silence */ }
    };

    const deleteTab = async (id: number) => {
        try {
            // First call without confirmed=true to get entry count
            const checkRes = await fetch(`/api/category/${id}`, { method: 'DELETE' });
            if (checkRes.status === 409) {
                const data = await checkRes.json();
                // Show detailed confirmation with entry count
                if (!confirm(data.message)) return;
                // Second call with confirmation
                const deleteRes = await fetch(`/api/category/${id}?confirmed=true`, { method: 'DELETE' });
                if (!deleteRes.ok) {
                    alert("Failed to delete category. Your data is safe.");
                    return;
                }
            } else if (!checkRes.ok) {
                alert("Failed to delete category.");
                return;
            }
            // Success — update UI
            setTabs(tabs.filter(t => t.CategoryID !== id));
            // Exact segment compare — pathname.includes(id) misfires when one id
            // is a substring of another (deleting 2 while viewing /journal/20).
            if (pathname.split('/')[2] === String(id)) router.push('/dashboard');
        } catch {
            alert("Failed to delete category. Your data is safe.");
        }
    };

    const handleImportClick = () => { fileInputRef.current?.click(); setIsFileMenuOpen(false); };
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!confirm("Overwrite data?")) return;
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/backup/import', { method: 'POST', body: formData });
        if (res.ok) window.location.reload();
        else alert("Import Failed");
    };

    const activeId = pathname.split('/')[2];

    // Menu actions owned by the TabBar (Tools panels + Categories ops + main
    // toolbar visibility). Dispatched by the MenuBar / Electron native menu.
    useEffect(() => {
        try {
            const tp = localStorage.getItem('tabsPosition');
            if (tp === 'top' || tp === 'bottom' || tp === 'vertical') setTabsPosition(tp);
        } catch { /* ignore */ }
        const num = activeId ? Number(activeId) : null;
        const handlers: Record<string, () => void> = {
            'trigger-reminders': () => setIsRemindersOpen(true),
            'trigger-wordcloud': () => setIsWordCloudOpen(true),
            'trigger-stats': () => setIsStatsOpen(true),
            'trigger-goals': () => setIsGoalsOpen(true),
            'trigger-snippets': () => setIsSnippetsOpen(true),
            'trigger-favorites': () => setIsFavoritesOpen(true),
            'trigger-habits': () => setIsHabitsOpen(true),
            'trigger-trash': () => setIsTrashOpen(true),
            'trigger-on-this-day': () => setIsOnThisDayOpen(true),
            'trigger-new-category': () => setIsAddMenuOpen(true),
            'trigger-category-properties': () => { if (num) setSettingsCategoryId(num); else window.alert('Open a category first to edit its properties.'); },
            'trigger-delete-category': () => { if (num) void deleteTab(num); else window.alert('Open a category first to delete it.'); },
            'trigger-import-entries': () => importEntriesInputRef.current?.click(),
            'trigger-export-entries': () => { if (activeId) window.open(`/api/category/${activeId}/export?format=html`, '_blank'); },
            'trigger-sync-category': () => window.alert('External category sync is not available in this build. Smartbook categories auto-collect matching entries; use Backup/Restore to move data between volumes.'),
            'trigger-toggle-main-toolbar': () => setMainToolbarHidden(v => !v),
            'trigger-tabs-top': () => { setTabsPosition('top'); try { localStorage.setItem('tabsPosition', 'top'); } catch { /* */ } },
            'trigger-tabs-bottom': () => { setTabsPosition('bottom'); try { localStorage.setItem('tabsPosition', 'bottom'); } catch { /* */ } },
            'trigger-tabs-vertical': () => { setTabsPosition('vertical'); try { localStorage.setItem('tabsPosition', 'vertical'); } catch { /* */ } },
        };
        for (const [evt, fn] of Object.entries(handlers)) window.addEventListener(evt, fn);
        return () => { for (const [evt, fn] of Object.entries(handlers)) window.removeEventListener(evt, fn); };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable; activeId captured fresh via re-subscribe
    }, [activeId]);

    const handleImportEntries = async (files: FileList | null) => {
        if (!files || files.length === 0 || !activeId) return;
        const fd = new FormData();
        for (const f of Array.from(files)) fd.append('file', f);
        try {
            const res = await fetch(`/api/category/${activeId}/import`, { method: 'POST', body: fd });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                alert(`Imported ${data.imported ?? 0} ${data.imported === 1 ? 'entry' : 'entries'}.`);
                window.location.reload();
            } else {
                alert(`Import failed: ${data.error || res.statusText}`);
            }
        } catch {
            alert('Import failed. See console for details.');
        }
    };

    return (
        <div
            className="flex flex-col w-full bg-bg-sidebar transition-colors duration-200"
            style={tabsPosition === 'bottom' ? { order: 2 } : undefined}
        >
            {/* Hidden file input for imports */}
            <input type="file" ref={fileInputRef} className="hidden" accept=".db,.sqlite,.tjdb" onChange={handleFileChange} />

            {/* Legacy web File/View dropdowns — replaced by the J8 MenuBar (rendered
                in journal/layout). Disabled to avoid a duplicate menu on web. */}
            {false && isClient && typeof window !== 'undefined' && !window.electron && (
                <div className="flex items-center px-4 py-1 space-x-4 bg-bg-card text-xs text-text-secondary select-none relative transition-colors duration-200">
                    <div className="w-6 h-6 bg-accent-primary rounded flex items-center justify-center font-bold text-white mr-2">J</div>

                    {/* File Dropdown */}
                    <div className="relative" ref={fileMenuRef}>
                        <span onClick={() => setIsFileMenuOpen(!isFileMenuOpen)} className="px-2 py-0.5 rounded cursor-pointer hover:bg-bg-hover">File</span>
                        {isFileMenuOpen && (
                            <div className="absolute top-full left-0 mt-1 w-48 bg-bg-card border border-border-primary rounded shadow-xl z-50 flex flex-col py-1">
                                <button onClick={handleImportClick} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Import DB...</button>
                                <button onClick={handleExportClick} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Export DB</button>
                                <button onClick={() => { window.dispatchEvent(new Event('trigger-print-entry')); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <FileText size={14} className="mr-2" />
                                    Print Entry...
                                </button>
                                <button onClick={() => { window.dispatchEvent(new Event('trigger-export-pdf')); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <FileText size={14} className="mr-2" />
                                    Export Entry to PDF...
                                </button>
                                <button onClick={() => { setIsTrashOpen(true); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Trash size={14} className="mr-2" />
                                    Trash...
                                </button>
                                <button onClick={() => { setIsRemindersOpen(true); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Bell size={14} className="mr-2" />
                                    Reminders...
                                </button>
                                <button onClick={() => { setIsGoalsOpen(true); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Target size={14} className="mr-2" />
                                    Word Goals...
                                </button>
                                <button onClick={() => { setIsStatsOpen(true); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <BarChart3 size={14} className="mr-2" />
                                    Statistics...
                                </button>
                                <button onClick={() => { setIsOnThisDayOpen(true); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Calendar size={14} className="mr-2" />
                                    On this day...
                                </button>
                                <button onClick={() => { setIsWordCloudOpen(true); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Cloud size={14} className="mr-2" />
                                    Word cloud...
                                </button>
                                <button onClick={() => { setIsSnippetsOpen(true); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Scissors size={14} className="mr-2" />
                                    Snippets...
                                </button>
                                {activeId && (
                                    <>
                                        <button onClick={() => { setIsReplaceOpen(true); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                            <Replace size={14} className="mr-2" />
                                            Find &amp; Replace...
                                        </button>
                                        <button onClick={() => { importEntriesInputRef.current?.click(); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                            <FileText size={14} className="mr-2" />
                                            Import entries (TXT/HTML/RTF)...
                                        </button>
                                        {([
                                            ['md', 'Markdown'],
                                            ['rtf', 'RTF (Word)'],
                                            ['html', 'HTML'],
                                            ['txt', 'Plain text'],
                                            ['atom', 'ATOM'],
                                        ] as const).map(([fmt, label]) => (
                                            <a
                                                key={fmt}
                                                href={`/api/category/${activeId}/export?format=${fmt}`}
                                                onClick={() => setIsFileMenuOpen(false)}
                                                className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center"
                                            >
                                                <FileText size={14} className="mr-2" />
                                                Export current as {label}
                                            </a>
                                        ))}
                                        <a
                                            href={`/api/report?categoryIds=${activeId}&format=html`}
                                            onClick={() => setIsFileMenuOpen(false)}
                                            className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center"
                                        >
                                            <FileText size={14} className="mr-2" />
                                            Entry report (HTML)
                                        </a>
                                        <a
                                            href={`/api/report?categoryIds=${activeId}&format=rtf`}
                                            onClick={() => setIsFileMenuOpen(false)}
                                            className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center"
                                        >
                                            <FileText size={14} className="mr-2" />
                                            Entry report (RTF)
                                        </a>
                                    </>
                                )}
                                <button onClick={() => { window.dispatchEvent(new Event('trigger-settings')); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Settings size={14} className="mr-2" />
                                    Settings...
                                </button>
                                <div className="border-t border-border-primary my-1"></div>
                                {/* Database & account maintenance — mirrors the Electron File menu. */}
                                <button onClick={() => { window.dispatchEvent(new Event('trigger-change-password')); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Settings size={14} className="mr-2" />
                                    Change Password...
                                </button>
                                <button onClick={() => { window.dispatchEvent(new Event('trigger-switch-user')); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <LogOut size={14} className="mr-2" />
                                    Switch User...
                                </button>
                                <button onClick={() => { window.dispatchEvent(new Event('trigger-check-integrity')); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Bug size={14} className="mr-2" />
                                    Check Integrity &amp; Repair...
                                </button>
                                <button onClick={() => { window.dispatchEvent(new Event('trigger-optimize-db')); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Wand2 size={14} className="mr-2" />
                                    Optimize Database...
                                </button>
                                <div className="border-t border-border-primary my-1"></div>
                                {/* Help — mirrors the Electron Help submenu so the web build has parity. */}
                                <a href="https://github.com/danielttran/TheJournal#readme" target="_blank" rel="noreferrer"
                                    onClick={() => setIsFileMenuOpen(false)}
                                    className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <HelpCircle size={14} className="mr-2" />
                                    Documentation
                                </a>
                                <button
                                    onClick={() => { window.dispatchEvent(new Event('trigger-settings')); setIsFileMenuOpen(false); }}
                                    className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Keyboard size={14} className="mr-2" />
                                    Keyboard Shortcuts
                                </button>
                                <a href="https://github.com/danielttran/TheJournal/blob/main/docs/plugins.md" target="_blank" rel="noreferrer"
                                    onClick={() => setIsFileMenuOpen(false)}
                                    className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <FileQuestion size={14} className="mr-2" />
                                    Plugin API Reference
                                </a>
                                <a href="https://github.com/danielttran/TheJournal/issues/new" target="_blank" rel="noreferrer"
                                    onClick={() => setIsFileMenuOpen(false)}
                                    className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Bug size={14} className="mr-2" />
                                    Report an Issue
                                </a>
                                <div className="border-t border-border-primary my-1"></div>
                                <button onClick={handleLogout} className="text-left px-4 py-2 hover:bg-red-500 hover:text-white transition-colors flex items-center">
                                    <LogOut size={14} className="mr-2" />
                                    Logout
                                </button>
                            </div>
                        )}
                    </div>
                    <span className="hover:bg-bg-hover px-2 py-0.5 rounded cursor-pointer hidden sm:block">Edit</span>

                    {/* View Dropdown */}
                    <div className="relative" ref={viewMenuRef}>
                        <span onClick={() => setIsViewMenuOpen(!isViewMenuOpen)} className="px-2 py-0.5 rounded cursor-pointer hover:bg-bg-hover hidden sm:block">View</span>
                        {isViewMenuOpen && (
                            <div className="absolute top-full left-0 mt-1 w-48 bg-bg-card border border-border-primary rounded shadow-xl z-50 flex flex-col py-1">
                                <button
                                    onClick={() => { dispatchViewAction('search'); setIsViewMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center justify-between group"
                                >
                                    <span>Search…</span>
                                    <kbd className="text-[10px] opacity-70 font-sans">Ctrl+F</kbd>
                                </button>
                                <button
                                    onClick={() => { dispatchViewAction('templates'); setIsViewMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center justify-between group"
                                >
                                    <span>Templates…</span>
                                    <kbd className="text-[10px] opacity-70 font-sans">Ctrl+Shift+T</kbd>
                                </button>
                                <button
                                    onClick={() => { dispatchViewAction('prompts'); setIsViewMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center justify-between group"
                                >
                                    <span>Writing Prompts…</span>
                                    <kbd className="text-[10px] opacity-70 font-sans">Ctrl+Shift+P</kbd>
                                </button>
                                <button
                                    onClick={() => { dispatchViewAction('focus'); setIsViewMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center justify-between group"
                                >
                                    <span>Focus Mode</span>
                                    <kbd className="text-[10px] opacity-70 font-sans">F11</kbd>
                                </button>
                                <button
                                    onClick={() => { dispatchViewAction('split'); setIsViewMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center justify-between group"
                                >
                                    <span>Toggle Split</span>
                                    <kbd className="text-[10px] opacity-70 font-sans">Ctrl+\\</kbd>
                                </button>
                                <button
                                    onClick={() => { dispatchViewAction('toggle-sidebar'); setIsViewMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center justify-between group"
                                >
                                    <span>Show / Hide Sidebar</span>
                                    <kbd className="text-[10px] opacity-70 font-sans">Ctrl+Shift+B</kbd>
                                </button>
                                <button onClick={() => { dispatchViewAction('sidebar-side'); setIsViewMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Move Sidebar Left / Right</button>
                                <button onClick={() => { dispatchViewAction('toggle-toolbar'); setIsViewMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Show / Hide Formatting Toolbar</button>
                                <div className="border-t border-border-primary my-1"></div>
                                <button onClick={() => { dispatchViewAction('undo'); setIsViewMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Undo</button>
                                <button onClick={() => { dispatchViewAction('redo'); setIsViewMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Redo</button>
                                <button onClick={() => { dispatchViewAction('inline-code'); setIsViewMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Inline Code</button>
                                <button onClick={() => { dispatchViewAction('checklist'); setIsViewMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Checklist</button>
                                <button onClick={() => { dispatchViewAction('highlight'); setIsViewMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Highlight</button>
                                <button onClick={() => { dispatchViewAction('hr'); setIsViewMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Horizontal Rule</button>
                                <button onClick={() => { dispatchViewAction('image-upload'); setIsViewMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Upload Image from PC…</button>
                                <div className="border-t border-border-primary my-1"></div>
                                <button
                                    onClick={() => {
                                        setTheme(theme === 'dark' ? 'light' : 'dark');
                                        setIsViewMenuOpen(false);
                                    }}
                                    className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors"
                                >
                                    Toggle Theme
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB STRIP (Sortable) — the "Main Toolbar" (View › Toolbars).
                Position follows View › Category Tabs Navigation (top/bottom/vertical). */}
            <div className={
                mainToolbarHidden ? 'hidden'
                : tabsPosition === 'vertical' ? 'flex flex-col items-stretch px-2 py-1 gap-1 bg-bg-sidebar max-h-[40vh] overflow-y-auto'
                : 'flex items-center px-2 pt-1 space-x-1 bg-bg-sidebar'
            }>
                {tabsPosition === 'vertical' ? (
                    <>
                        {/* Nestable category tree (hierarchical categories). */}
                        <CategoryTree
                            categories={tabs}
                            activeId={activeId}
                            onNavigate={(id) => router.push(`/journal/${id}`)}
                            onOpenSettings={(id) => setSettingsCategoryId(id)}
                            onDelete={deleteTab}
                            onAddSub={(parentId) => { setPendingParentId(parentId); setIsAddMenuOpen(true); }}
                            onReparent={handleReparent}
                        />
                        <button onClick={() => { setPendingParentId(null); setIsAddMenuOpen(true); }}
                            className="mt-1 flex items-center gap-1 rounded px-1 py-1 text-sm text-text-muted hover:bg-bg-hover">
                            <Plus className="w-4 h-4" /> New category
                        </button>
                    </>
                ) : (
                    <>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={tabs.map(c => c.CategoryID)} strategy={horizontalListSortingStrategy}>
                                {tabs.map((tab) => (
                                    <SortableTab
                                        key={tab.CategoryID}
                                        category={tab}
                                        isActive={String(tab.CategoryID) === activeId}
                                        onClick={() => router.push(`/journal/${tab.CategoryID}`)}
                                        onDelete={deleteTab}
                                        onRename={handleRename}
                                        onIconChange={handleIconChange}
                                        onColorChange={handleColorChange}
                                        onOpenSettings={(id) => setSettingsCategoryId(id)}
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>

                        <button onClick={() => setIsAddMenuOpen(true)} className="h-8 w-8 flex items-center justify-center text-text-muted hover:bg-bg-hover rounded">
                            <Plus className="w-5 h-5" />
                        </button>
                    </>
                )}
            </div>

            {/* MODAL (Compact) */}
            {isAddMenuOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="bg-bg-card p-6 rounded-lg w-80 border border-border-primary">
                        <h3 className="text-text-primary mb-4 font-bold">{pendingParentId != null ? 'New Sub-Category' : 'New Tab'}</h3>
                        <input className="w-full bg-bg-active border border-border-primary p-2 text-text-primary mb-4 rounded"
                            placeholder="Name" value={newTabName} onChange={e => setNewTabName(e.target.value)} autoFocus />
                        <div className="flex gap-2 mb-4">
                            <button onClick={() => setNewTabType('Journal')} className={`flex-1 p-2 border rounded ${newTabType === 'Journal' ? 'bg-accent-primary text-white border-accent-primary' : 'border-border-primary text-text-secondary'}`}>Journal</button>
                            <button onClick={() => setNewTabType('Notebook')} className={`flex-1 p-2 border rounded ${newTabType === 'Notebook' ? 'bg-accent-primary text-white border-accent-primary' : 'border-border-primary text-text-secondary'}`}>Notebook</button>
                        </div>
                        <label className="flex items-center gap-2 mb-4 text-sm text-text-secondary cursor-pointer">
                            <input
                                type="checkbox"
                                checked={newTabIsSmartbook}
                                onChange={e => setNewTabIsSmartbook(e.target.checked)}
                            />
                            <span>
                                Smartbook — auto-collect entries matching a saved query
                            </span>
                        </label>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => { setIsAddMenuOpen(false); setPendingParentId(null); }} className="px-3 py-1 text-text-muted hover:text-text-primary">Cancel</button>
                            <button onClick={handleCreateTab} disabled={!newTabName} className="px-3 py-1 bg-accent-primary text-white rounded hover:bg-opacity-90">Create</button>
                        </div>
                    </div>
                </div>
            )}

            {isTrashOpen && (
                <TrashPanel
                    onClose={() => setIsTrashOpen(false)}
                    onChanged={() => window.dispatchEvent(new Event('journal-entry-updated'))}
                />
            )}

            {isRemindersOpen && (
                <RemindersPanel onClose={() => setIsRemindersOpen(false)} />
            )}

            <input
                ref={importEntriesInputRef}
                type="file"
                multiple
                accept=".txt,.text,.htm,.html,.rtf"
                className="hidden"
                onChange={(e) => { handleImportEntries(e.target.files); e.target.value = ''; }}
            />

            {isGoalsOpen && (
                <GoalsPanel onClose={() => setIsGoalsOpen(false)} />
            )}

            {isStatsOpen && (
                <StatsPanel onClose={() => setIsStatsOpen(false)} />
            )}

            {isReplaceOpen && activeId && (
                <ReplacePanel categoryId={parseInt(activeId, 10)} onClose={() => setIsReplaceOpen(false)} />
            )}

            {isOnThisDayOpen && (
                <OnThisDayPanel onClose={() => setIsOnThisDayOpen(false)} />
            )}

            {isWordCloudOpen && (
                <WordCloudPanel
                    categoryId={activeId ? parseInt(activeId, 10) : undefined}
                    onClose={() => setIsWordCloudOpen(false)}
                />
            )}

            {isFavoritesOpen && (
                <FavoritesPanel onClose={() => setIsFavoritesOpen(false)} />
            )}

            {isHabitsOpen && (
                <HabitsPanel onClose={() => setIsHabitsOpen(false)} />
            )}

            {isSnippetsOpen && (
                <SnippetsPanel
                    onClose={() => setIsSnippetsOpen(false)}
                    onInsert={(html) => window.dispatchEvent(new CustomEvent('trigger-insert-snippet', { detail: html }))}
                />
            )}

            {settingsCategoryId !== null && (
                <CategorySettingsModal
                    categoryId={settingsCategoryId}
                    onClose={() => setSettingsCategoryId(null)}
                    onSaved={(updated) => {
                        setTabs(prev => prev.map(c => c.CategoryID === settingsCategoryId ? { ...c, ...updated } : c));
                    }}
                />
            )}

        </div>
    );
}
