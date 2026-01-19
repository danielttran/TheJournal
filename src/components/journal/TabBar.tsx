"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Plus, X, Book, FileText } from 'lucide-react';
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

interface Category {
    CategoryID: number;
    Name: string;
    Type: 'Journal' | 'Notebook';
    Color: string;
    SortOrder?: number;
}

// ---------------------------
// Sortable Tab Component
// ---------------------------
function SortableTab({ category, isActive, onClick, onDelete, onRename }: any) {
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

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        }
    };

    const handleSave = () => {
        setIsEditing(false);
        if (editName.trim() !== category.Name) {
            onRename(category.CategoryID, editName);
        }
    };

    if (isEditing) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className={`
                    group flex items-center gap-2 px-3 py-1 min-w-[120px] max-w-[200px] h-9 rounded-t-lg text-sm font-medium transition-all select-none
                    ${isActive
                        ? 'bg-[#1e1e1e] text-white border-t-2 border-purple-500'
                        : 'bg-[#2d2d2d] text-gray-400'
                    }
                `}
            >
                {category.Type === 'Notebook' ? <FileText size={14} /> : <Book size={14} />}
                <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSave}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent border-none outline-none w-full min-w-0 text-white"
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
                group flex items-center min-w-[120px] max-w-[200px] h-9 px-3 rounded-t-lg text-sm cursor-pointer select-none transition-colors
                ${isActive
                    ? 'bg-[#111827] text-white border-t-2 border-purple-500'
                    : 'bg-[#2d2d2d] text-gray-400 hover:bg-[#333]'
                }
            `}
        >
            {category.Type === 'Journal' ? <Book className="w-3.5 h-3.5 mr-2 opacity-70" /> : <FileText className="w-3.5 h-3.5 mr-2 opacity-70" />}
            <span className="truncate flex-1">{category.Name}</span>
            <button
                onClick={(e) => { e.stopPropagation(); onDelete(category.CategoryID); }}
                className={`p-0.5 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-2`}
            >
                <X size={12} />
            </button>
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
        // ... (Same as before)
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
        <div className="flex flex-col w-full bg-[#1e1e1e] border-b border-[#333]">
            {/* FILE MENU & HEADER */}
            <div className="flex items-center px-4 py-1 space-x-4 bg-[#2d2d2d] text-xs text-gray-300 select-none relative">
                <div className="w-6 h-6 bg-purple-600 rounded flex items-center justify-center font-bold text-white mr-2">J</div>
                <input type="file" ref={fileInputRef} className="hidden" accept=".db,.sqlite" onChange={handleFileChange} />

                {/* File Dropdown */}
                <div className="relative">
                    <span onClick={() => setIsFileMenuOpen(!isFileMenuOpen)} className="px-2 py-0.5 rounded cursor-pointer hover:bg-gray-700">File</span>
                    {isFileMenuOpen && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-[#2d2d2d] border border-[#444] rounded shadow-xl z-50 flex flex-col py-1">
                            <button onClick={handleImportClick} className="text-left px-4 py-2 hover:bg-purple-600">Import DB...</button>
                            <button onClick={handleExportClick} className="text-left px-4 py-2 hover:bg-purple-600">Export DB</button>
                        </div>
                    )}
                </div>
                <span className="hover:bg-gray-700 px-2 py-0.5 rounded cursor-pointer">Edit</span>
                <span className="hover:bg-gray-700 px-2 py-0.5 rounded cursor-pointer">View</span>
            </div>

            {/* TAB STRIP (Sortable) */}
            <div className="flex items-center px-2 pt-2 space-x-1 overflow-x-auto no-scrollbar bg-[#1e1e1e]">
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
                            />
                        ))}
                    </SortableContext>
                </DndContext>

                <button onClick={() => setIsModalOpen(true)} className="h-8 w-8 flex items-center justify-center text-gray-400 hover:bg-[#333] rounded">
                    <Plus className="w-5 h-5" />
                </button>
            </div>

            {/* MODAL (Compact) */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="bg-[#2d2d2d] p-6 rounded-lg w-80 border border-[#444]">
                        <h3 className="text-white mb-4 font-bold">New Tab</h3>
                        <input className="w-full bg-[#1e1e1e] border border-[#444] p-2 text-white mb-4 rounded"
                            placeholder="Name" value={newTabName} onChange={e => setNewTabName(e.target.value)} autoFocus />
                        <div className="flex gap-2 mb-4">
                            <button onClick={() => setNewTabType('Journal')} className={`flex-1 p-2 border rounded ${newTabType === 'Journal' ? 'bg-purple-900 border-purple-500' : 'border-[#444] text-gray-400'}`}>Journal</button>
                            <button onClick={() => setNewTabType('Notebook')} className={`flex-1 p-2 border rounded ${newTabType === 'Notebook' ? 'bg-purple-900 border-purple-500' : 'border-[#444] text-gray-400'}`}>Notebook</button>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setIsModalOpen(false)} className="px-3 py-1 text-gray-400">Cancel</button>
                            <button onClick={handleCreateTab} disabled={!newTabName} className="px-3 py-1 bg-purple-600 text-white rounded">Create</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
