"use client";

import { useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Settings, Trash2, BookOpen, Calendar } from 'lucide-react';
import type { Category } from '@/lib/types';
import { buildCategoryTree, flattenTree } from '@/lib/categoryTree';

const COLLAPSE_KEY = 'categoryTreeCollapsed';

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
 * bottom strips keep their flat sortable rendering. Nesting itself is set via
 * Category Properties (parent dropdown) or the per-row "add sub-category" (+).
 */
export default function CategoryTree({
    categories, activeId, onNavigate, onOpenSettings, onDelete, onAddSub,
}: {
    categories: Category[];
    activeId: string;
    onNavigate: (id: number) => void;
    onOpenSettings: (id: number) => void;
    onDelete: (id: number) => void;
    onAddSub: (parentId: number) => void;
}) {
    const [collapsed, setCollapsed] = useState<Set<number>>(loadCollapsed);

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

    const tree = buildCategoryTree(categories);
    const rows = flattenTree(tree, collapsed);

    return (
        <div className="flex flex-col items-stretch gap-0.5">
            {rows.map(node => {
                const c = node.category;
                const hasChildren = node.children.length > 0;
                const isActive = String(c.CategoryID) === activeId;
                const isCollapsed = collapsed.has(c.CategoryID);
                return (
                    <div
                        key={c.CategoryID}
                        className={`group flex items-center gap-1 rounded px-1 py-1 text-sm cursor-pointer
                            ${isActive ? 'bg-accent-primary/15 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'}`}
                        style={{ paddingLeft: 4 + node.depth * 14 }}
                        onClick={() => onNavigate(c.CategoryID)}
                        title={c.Name}
                    >
                        {hasChildren ? (
                            <button
                                onClick={e => { e.stopPropagation(); toggle(c.CategoryID); }}
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
                            <button onClick={e => { e.stopPropagation(); expandThenAddSub(c.CategoryID); }}
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
            })}
        </div>
    );
}
