"use client";

import { useState, useEffect, useRef } from 'react';
import { ThemeToggle } from '../ThemeToggle';
import { useRouter, usePathname } from 'next/navigation';
import { Plus, X, Book, FileText } from 'lucide-react';
import dynamic from 'next/dynamic';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
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

interface Category {
    CategoryID: number;
    Name: string;
    Type: 'Journal' | 'Notebook';
    Color: string;
    SortOrder?: number;
    Icon?: string;
}

// ---------------------------
// Sortable Tab Component
// ---------------------------
function SortableTab({ category, isActive, onClick, onDelete, onRename, onIconChange }: any) {
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
    const pickerRef = useRef<HTMLDivElement>(null);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    // Close picker when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                setShowPicker(false);
            }
        }
        if (showPicker) document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [showPicker]);

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
        e.stopPropagation();
        setShowPicker(!showPicker);
    }

    const onEmojiClick = (emojiData: any, event: MouseEvent) => {
        event.stopPropagation();
        onIconChange(category.CategoryID, emojiData.emoji);
        setShowPicker(false);
    }

    // Default Icon if none set
    const DisplayIcon = () => {
        if (category.Icon) return <span className="mr-2 text-base leading-none">{category.Icon}</span>;
        return category.Type === 'Notebook' ? <FileText size={14} className="mr-2 opacity-70" /> : <Book size={14} className="mr-2 opacity-70" />;
    };

    if (isEditing) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className={`
                    group flex items-center gap-2 px-3 py-1 min-w-[120px] max-w-[200px] h-9 rounded-t-lg text-sm font-medium transition-all select-none
                    ${isActive
                        ? 'bg-bg-app text-text-primary border-t-2 border-accent-primary'
                        : 'bg-bg-card text-text-secondary'
                    }
                `}
            >
                <DisplayIcon />
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
            style={style}
            {...attributes}
            {...listeners}
            onClick={onClick}
            onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
            }}
            className={`
                relative group flex items-center min-w-[120px] max-w-[200px] h-9 px-3 rounded-t-lg text-sm cursor-pointer select-none transition-colors
                ${isActive
                    ? 'bg-bg-app text-text-primary border-t-2 border-accent-primary'
                    : 'bg-bg-card text-text-secondary hover:bg-bg-hover'
                }
            `}
        >
            <div onClick={togglePicker} className="hover:bg-bg-active/50 rounded p-0.5 cursor-pointer flex items-center justify-center">
                <DisplayIcon />
            </div>

            <span className="truncate flex-1">{category.Name}</span>
            <button
                onClick={(e) => { e.stopPropagation(); onDelete(category.CategoryID); }}
                className={`p-0.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-2`}
            >
                <X size={12} />
            </button>

            {/* Modal Portal for Emoji Picker */}
            {showPicker && (
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
                            theme={"dark" as any}
                        />
                    </div>
                </div>
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
    const [tabs, setTabs] = useState<Category[]>([]);

    // UI State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newTabName, setNewTabName] = useState('');
    const [newTabType, setNewTabType] = useState<'Journal' | 'Notebook'>('Journal');
    const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Initial Load
    useEffect(() => {
        fetchTabs();
    }, []);

    const fetchTabs = async () => {
        try {
            const res = await fetch('/api/category');
            const data = await res.json();
            if (Array.isArray(data)) {
                // Sort by SortOrder if available
                const sorted = data.sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
                setTabs(sorted);
            }
        } catch (error) {
            console.error("Failed to load tabs", error);
        }
    };

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
            }).catch(console.error);
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

    const handleCreateTab = async () => {
        try {
            const res = await fetch('/api/category', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newTabName, type: newTabType, userId })
            });
            const newCat = await res.json();
            if (newCat.id) {
                setTabs([...tabs, { CategoryID: newCat.id, Name: newTabName, Type: newTabType, Color: '#fff', SortOrder: tabs.length }]);
                setIsModalOpen(false);
                setNewTabName('');
                router.push(`/journal/${newCat.id}`);
            }
        } catch (error) { console.error(error); }
    };

    const deleteTab = async (id: number) => {
        if (!confirm("Are you sure? This deletes all entries.")) return;
        setTabs(tabs.filter(t => t.CategoryID !== id)); // Optimistic
        await fetch(`/api/category/${id}`, { method: 'DELETE' });
        // Redirect if active...
        if (pathname.includes(String(id))) router.push('/dashboard');
    };

    // Other Handlers (File Menu)
    const handleImportClick = () => { fileInputRef.current?.click(); setIsFileMenuOpen(false); };
    const handleExportClick = () => { window.open('/api/backup/export', '_blank'); setIsFileMenuOpen(false); };
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
        <div className="flex flex-col w-full bg-bg-sidebar border-b border-border-primary transition-colors duration-200">
            {/* FILE MENU & HEADER */}
            <div className="flex items-center px-4 py-1 space-x-4 bg-bg-card text-xs text-text-secondary select-none relative transition-colors duration-200">
                <div className="w-6 h-6 bg-accent-primary rounded flex items-center justify-center font-bold text-white mr-2">J</div>
                <input type="file" ref={fileInputRef} className="hidden" accept=".db,.sqlite" onChange={handleFileChange} />

                {/* File Dropdown */}
                <div className="relative">
                    <span onClick={() => setIsFileMenuOpen(!isFileMenuOpen)} className="px-2 py-0.5 rounded cursor-pointer hover:bg-bg-hover">File</span>
                    {isFileMenuOpen && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-bg-card border border-border-primary rounded shadow-xl z-50 flex flex-col py-1">
                            <button onClick={handleImportClick} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Import DB...</button>
                            <button onClick={handleExportClick} className="text-left px-4 py-2 hover:bg-accent-primary hover:text-white transition-colors">Export DB</button>
                        </div>
                    )}
                </div>
                <span className="hover:bg-bg-hover px-2 py-0.5 rounded cursor-pointer hidden sm:block">Edit</span>
                <span className="hover:bg-bg-hover px-2 py-0.5 rounded cursor-pointer hidden sm:block">View</span>

                <div className="ml-auto">
                    <ThemeToggle />
                </div>
            </div>

            {/* TAB STRIP (Sortable) */}
            <div className="flex items-center px-2 pt-2 space-x-1 overflow-x-auto no-scrollbar bg-bg-sidebar">
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
                            />
                        ))}
                    </SortableContext>
                </DndContext>

                <button onClick={() => setIsModalOpen(true)} className="h-8 w-8 flex items-center justify-center text-text-muted hover:bg-bg-hover rounded">
                    <Plus className="w-5 h-5" />
                </button>
            </div>

            {/* MODAL (Compact) */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="bg-bg-card p-6 rounded-lg w-80 border border-border-primary">
                        <h3 className="text-text-primary mb-4 font-bold">New Tab</h3>
                        <input className="w-full bg-bg-active border border-border-primary p-2 text-text-primary mb-4 rounded"
                            placeholder="Name" value={newTabName} onChange={e => setNewTabName(e.target.value)} autoFocus />
                        <div className="flex gap-2 mb-4">
                            <button onClick={() => setNewTabType('Journal')} className={`flex-1 p-2 border rounded ${newTabType === 'Journal' ? 'bg-accent-secondary border-accent-primary text-accent-primary' : 'border-border-primary text-text-secondary'}`}>Journal</button>
                            <button onClick={() => setNewTabType('Notebook')} className={`flex-1 p-2 border rounded ${newTabType === 'Notebook' ? 'bg-accent-secondary border-accent-primary text-accent-primary' : 'border-border-primary text-text-secondary'}`}>Notebook</button>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setIsModalOpen(false)} className="px-3 py-1 text-text-muted hover:text-text-primary">Cancel</button>
                            <button onClick={handleCreateTab} disabled={!newTabName} className="px-3 py-1 bg-accent-primary text-white rounded hover:bg-opacity-90">Create</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
