"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { X, Plus, Book, FileText, LogOut, Settings } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Theme as EmojiTheme } from 'emoji-picker-react';
import { useClickOutside } from '@/hooks';
import SettingsModal from '../SettingsModal';
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
}

const PRESET_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
    '#f97316', '#eab308', '#22c55e', '#14b8a6',
    '#0ea5e9', '#64748b', '#a855f7', '#06b6d4',
];

function SortableTab({ category, isActive, onClick, onDelete, onRename, onIconChange, onColorChange }: SortableTabProps) {
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
    const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
    const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isClient, setIsClient] = useState(false);
    useEffect(() => setIsClient(true), []);

    // Refs for clicking outside
    const fileInputRef = useRef<HTMLInputElement>(null);
    const fileMenuRef = useRef<HTMLDivElement>(null);
    const viewMenuRef = useRef<HTMLDivElement>(null);

    const handleFileImport = useCallback(async (filePath: string) => {
        if (!confirm("Overwrite data?")) return;
        const formData = new FormData();
        const response = await fetch(filePath);
        const blob = await response.blob();
        formData.append('file', blob, filePath.split(/[\\/]/).pop() || 'import.db');
        const res = await fetch('/api/backup/import', { method: 'POST', body: formData });
        if (res.ok) window.location.reload();
        else alert("Import Failed");
    }, []);

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

    // Click away handlers using custom hook
    const closeFileMenu = useCallback(() => setIsFileMenuOpen(false), []);
    const closeViewMenu = useCallback(() => setIsViewMenuOpen(false), []);
    const dispatchViewAction = useCallback((action: string) => {
        window.dispatchEvent(new CustomEvent(`trigger-${action}`));
    }, []);
    useClickOutside(fileMenuRef, closeFileMenu, isFileMenuOpen);
    useClickOutside(viewMenuRef, closeViewMenu, isViewMenuOpen);

    // Listen for Electron menu events
    useEffect(() => {
        if (!window.electron) return;

        const unsubscribeImport = window.electron.onImportDB?.((filePath: string) => {
            handleFileImport(filePath);
        });

        const unsubscribeExport = window.electron.onExportDB?.(() => {
            handleExportClick();
        });

        const unsubscribeLogout = window.electron.onLogoutRequest?.(() => {
            handleLogout();
        });

        const unsubscribeOpenSettings = window.electron.onOpenSettings?.(() => {
            setIsSettingsOpen(true);
        });
        const unsubscribeViewAction = window.electron.onViewAction?.((action: string) => {
            dispatchViewAction(action);
        });

        return () => {
            unsubscribeImport?.();
            unsubscribeExport?.();
            unsubscribeLogout?.();
            unsubscribeOpenSettings?.();
            unsubscribeViewAction?.();
        };
    }, [dispatchViewAction, handleExportClick, handleFileImport, handleLogout]);

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
            const res = await fetch('/api/category', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newTabName, type: newTabType, userId, color: randomColor })
            });
            const newCat = await res.json();
            if (newCat.id) {
                setTabs([...tabs, { CategoryID: newCat.id, Name: newTabName, Type: newTabType, Color: randomColor, SortOrder: tabs.length }]);
                setIsAddMenuOpen(false);
                setNewTabName('');
                router.push(`/journal/${newCat.id}`);
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
            if (pathname.includes(String(id))) router.push('/dashboard');
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

    return (
        <div className="flex flex-col w-full bg-bg-sidebar transition-colors duration-200">
            {/* Hidden file input for imports */}
            <input type="file" ref={fileInputRef} className="hidden" accept=".db,.sqlite,.tjdb" onChange={handleFileChange} />

            {/* FILE MENU & HEADER - Show in web, but hide in Electron to avoid duplicate menu */}
            {isClient && typeof window !== 'undefined' && !window.electron && (
                <div className="flex items-center px-4 py-1 space-x-4 bg-bg-card text-xs text-text-secondary select-none relative transition-colors duration-200">
                    <div className="w-6 h-6 bg-accent-primary rounded flex items-center justify-center font-bold text-white mr-2">J</div>

                    {/* File Dropdown */}
                    <div className="relative" ref={fileMenuRef}>
                        <span onClick={() => setIsFileMenuOpen(!isFileMenuOpen)} className="px-2 py-0.5 rounded cursor-pointer hover:bg-bg-hover">File</span>
                        {isFileMenuOpen && (
                            <div className="absolute top-full left-0 mt-1 w-48 bg-bg-card border border-border-primary rounded shadow-xl z-50 flex flex-col py-1">
                                <button onClick={handleImportClick} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Import DB...</button>
                                <button onClick={handleExportClick} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Export DB</button>
                                <button onClick={() => { setIsSettingsOpen(true); setIsFileMenuOpen(false); }} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors flex items-center">
                                    <Settings size={14} className="mr-2" />
                                    Settings...
                                </button>
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

            {/* TAB STRIP (Sortable) */}
            <div className="flex items-center px-2 pt-1 space-x-1 bg-bg-sidebar">
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
                            />
                        ))}
                    </SortableContext>
                </DndContext>

                <button onClick={() => setIsAddMenuOpen(true)} className="h-8 w-8 flex items-center justify-center text-text-muted hover:bg-bg-hover rounded">
                    <Plus className="w-5 h-5" />
                </button>
            </div>

            {/* MODAL (Compact) */}
            {isAddMenuOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="bg-bg-card p-6 rounded-lg w-80 border border-border-primary">
                        <h3 className="text-text-primary mb-4 font-bold">New Tab</h3>
                        <input className="w-full bg-bg-active border border-border-primary p-2 text-text-primary mb-4 rounded"
                            placeholder="Name" value={newTabName} onChange={e => setNewTabName(e.target.value)} autoFocus />
                        <div className="flex gap-2 mb-4">
                            <button onClick={() => setNewTabType('Journal')} className={`flex-1 p-2 border rounded ${newTabType === 'Journal' ? 'bg-accent-primary text-white border-accent-primary' : 'border-border-primary text-text-secondary'}`}>Journal</button>
                            <button onClick={() => setNewTabType('Notebook')} className={`flex-1 p-2 border rounded ${newTabType === 'Notebook' ? 'bg-accent-primary text-white border-accent-primary' : 'border-border-primary text-text-secondary'}`}>Notebook</button>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setIsAddMenuOpen(false)} className="px-3 py-1 text-text-muted hover:text-text-primary">Cancel</button>
                            <button onClick={handleCreateTab} disabled={!newTabName} className="px-3 py-1 bg-accent-primary text-white rounded hover:bg-opacity-90">Create</button>
                        </div>
                    </div>
                </div>
            )}

            <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        </div>
    );
}
