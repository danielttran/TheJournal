"use client";

import { useState } from 'react';
import {
    DndContext, DragEndEvent, KeyboardSensor, PointerSensor,
    useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { ChevronRight, ChevronDown, Plus, Settings, Trash2, BookOpen, Calendar, GripVertical } from 'lucide-react';
import type { Category } from '@/lib/types';
import { buildCategoryTree, flattenTree, resolveCategoryDrop } from '@/lib/categoryTree';

const COLLAPSE_KEY = 'categoryTreeCollapsed';
const ROOT_DROP_ID = '__root__';

function loadCollapsed(): Set<number> {
    try {
        const raw = localStorage.getItem(COLLAPSE_KEY);
        if (raw) return new Set<number>(JSON.parse(raw));
    } catch { /* ignore */ }
    return new Set<number>();
}

/**
 * Vertical, nestable category tree (J8 hierarchical categories / loose-leaf at
 * the category level). Only used in the "vertical" tabs mode; the horizontal /
 * bottom strips keep their flat sortable rendering. Nesting is set by dragging
 * a row onto another row (drop = becomes its child) or onto the bottom "root"
 * zone (drop = promote to top level); it can also be set via Category
 * Properties (parent dropdown) or the per-row "add sub-category" (+).
 */
export default function CategoryTree({
    categories, activeId, onNavigate, onOpenSettings, onDelete, onAddSub, onReparent,
}: {
    categories: Category[];
    activeId: string;
    onNavigate: (id: number) => void;
    onOpenSettings: (id: number) => void;
    onDelete: (id: number) => void;
    onAddSub: (parentId: number) => void;
    onReparent: (id: number, parentId: number | null) => void;
}) {
    const [collapsed, setCollapsed] = useState<Set<number>>(loadCollapsed);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor),
    );

    const toggle = (id: number) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
            return next;
        });
    };

    // Adding a sub-category to a collapsed parent would hide the new child;
    // expand the parent first so the result is visible.
    const expandThenAddSub = (id: number) => {
        setCollapsed(prev => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
            return next;
        });
        onAddSub(id);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;
        const draggedId = Number(active.id);
        const targetId = over.id === ROOT_DROP_ID ? null : Number(over.id);
        const res = resolveCategoryDrop(categories, draggedId, targetId);
        if (res.ok) onReparent(draggedId, res.parentId);
    };

    const tree = buildCategoryTree(categories);
    const rows = flattenTree(tree, collapsed);

    return (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="flex flex-col items-stretch gap-0.5">
                {rows.map(node => {
                    const c = node.category;
                    return (
                        <TreeRow
                            key={c.CategoryID}
                            category={c}
                            depth={node.depth}
                            hasChildren={node.children.length > 0}
                            isActive={String(c.CategoryID) === activeId}
                            isCollapsed={collapsed.has(c.CategoryID)}
                            onNavigate={onNavigate}
                            onToggle={toggle}
                            onOpenSettings={onOpenSettings}
                            onDelete={onDelete}
                            onAddSub={expandThenAddSub}
                        />
                    );
                })}
                <RootDropZone />
            </div>
        </DndContext>
    );
}

function TreeRow({
    category: c, depth, hasChildren, isActive, isCollapsed,
    onNavigate, onToggle, onOpenSettings, onDelete, onAddSub,
}: {
    category: Category;
    depth: number;
    hasChildren: boolean;
    isActive: boolean;
    isCollapsed: boolean;
    onNavigate: (id: number) => void;
    onToggle: (id: number) => void;
    onOpenSettings: (id: number) => void;
    onDelete: (id: number) => void;
    onAddSub: (id: number) => void;
}) {
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: c.CategoryID });
    const { setNodeRef: setDropRef, isOver } = useDroppable({ id: c.CategoryID });

    return (
        <div
            ref={setDropRef}
            className={`group flex items-center gap-1 rounded px-1 py-1 text-sm cursor-pointer
                ${isActive ? 'bg-accent-primary/15 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'}
                ${isOver ? 'ring-1 ring-accent-primary ring-inset' : ''}
                ${isDragging ? 'opacity-40' : ''}`}
            style={{ paddingLeft: 4 + depth * 14 }}
            onClick={() => onNavigate(c.CategoryID)}
            title={c.Name}
        >
            <button
                ref={setDragRef}
                {...attributes}
                {...listeners}
                onClick={e => e.stopPropagation()}
                className="flex h-4 w-3 cursor-grab items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 active:cursor-grabbing"
                title="Drag to nest under another category"
                aria-label={`Reorder ${c.Name}`}
            >
                <GripVertical size={12} />
            </button>

            {hasChildren ? (
                <button
                    onClick={e => { e.stopPropagation(); onToggle(c.CategoryID); }}
                    className="flex h-4 w-4 items-center justify-center text-text-muted hover:text-text-primary"
                    title={isCollapsed ? 'Expand' : 'Collapse'}
                >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
            ) : (
                <span className="inline-block h-4 w-4" />
            )}

            {c.Color
                ? <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: c.Color }} />
                : c.Type === 'Journal' ? <Calendar size={14} className="flex-shrink-0" /> : <BookOpen size={14} className="flex-shrink-0" />}

            <span className="flex-1 truncate">{c.Icon ? `${c.Icon} ` : ''}{c.Name}</span>

            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                <button onClick={e => { e.stopPropagation(); onAddSub(c.CategoryID); }}
                    className="p-0.5 text-text-muted hover:text-text-primary" title="Add sub-category">
                    <Plus size={13} />
                </button>
                <button onClick={e => { e.stopPropagation(); onOpenSettings(c.CategoryID); }}
                    className="p-0.5 text-text-muted hover:text-text-primary" title="Category properties">
                    <Settings size={13} />
                </button>
                <button onClick={e => { e.stopPropagation(); onDelete(c.CategoryID); }}
                    className="p-0.5 text-text-muted hover:text-red-400" title="Delete category">
                    <Trash2 size={13} />
                </button>
            </div>
        </div>
    );
}

/** Drop target that promotes a dragged category back to the top level. */
function RootDropZone() {
    const { setNodeRef, isOver, active } = useDroppable({ id: ROOT_DROP_ID });
    if (!active) return null; // only visible mid-drag
    return (
        <div
            ref={setNodeRef}
            className={`mt-1 rounded border border-dashed px-2 py-1.5 text-center text-xs text-text-muted
                ${isOver ? 'border-accent-primary bg-accent-primary/10 text-text-primary' : 'border-border'}`}
        >
            Drop here to move to top level
        </div>
    );
}
