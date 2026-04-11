"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { ChevronRight, Home, ChevronDown, Folder, File, Calendar } from 'lucide-react';
import { useRouter } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BreadcrumbItem {
    id: number | string;
    title: string;
    /** 'Year' and 'Month' are Journal-specific virtual levels. */
    type: 'Category' | 'Section' | 'Page' | 'Year' | 'Month';
    categoryType?: 'Journal' | 'Notebook';
}

interface BreadcrumbsProps {
    categoryId: string;
    categoryName: string;
    categoryType: string;
    /** Editor mode — show path to this entry (last item omitted). */
    entryId?: number | null;
    /** Section-grid mode — show path to this section (last item omitted). */
    sectionId?: number | null;
    /** Month-grid mode — synthesise [Category, Year] without an API call. */
    monthKey?: string | null;  // "YYYY-MM"
    /** Year-grid mode — synthesise [Category] without an API call. */
    yearKey?: string | null;   // "YYYY"
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMonthGridPath(
    categoryId: string,
    categoryName: string,
    categoryType: string,
    monthKey: string
): BreadcrumbItem[] {
    const [y, m] = monthKey.split('-').map(Number);
    const year = y.toString();
    const monthName = new Date(y, m - 1).toLocaleString('default', { month: 'long' });
    return [
        { id: parseInt(categoryId, 10), title: categoryName, type: 'Category', categoryType: categoryType as 'Journal' | 'Notebook' },
        { id: `year-${year}`, title: year, type: 'Year', categoryType: 'Journal' },
        { id: `month-${monthKey}`, title: monthName, type: 'Month', categoryType: 'Journal' },
    ];
}

function buildYearGridPath(
    categoryId: string,
    categoryName: string,
    categoryType: string,
    yearKey: string
): BreadcrumbItem[] {
    return [
        { id: parseInt(categoryId, 10), title: categoryName, type: 'Category', categoryType: categoryType as 'Journal' | 'Notebook' },
        { id: `year-${yearKey}`, title: yearKey, type: 'Year', categoryType: 'Journal' },
    ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Breadcrumbs({
    categoryId,
    categoryName,
    categoryType,
    entryId,
    sectionId,
    monthKey,
    yearKey,
}: BreadcrumbsProps) {
    const router = useRouter();
    const [path, setPath] = useState<BreadcrumbItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [openMenu, setOpenMenu] = useState<string | number | null>(null);
    const [menuItems, setMenuItems] = useState<any[]>([]);
    const [menuLoading, setMenuLoading] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // ── Derive the breadcrumb path ──────────────────────────────────────────
    useEffect(() => {
        // Virtual paths — no API needed
        if (yearKey && !monthKey && !entryId && !sectionId) {
            // Year-grid view: show [Category, Year] but display only [Category]
            setPath(buildYearGridPath(categoryId, categoryName, categoryType, yearKey));
            return;
        }
        if (monthKey && !entryId && !sectionId) {
            // Month-grid view: show [Category, Year, Month] but display first two
            setPath(buildMonthGridPath(categoryId, categoryName, categoryType, monthKey));
            return;
        }

        const targetId = entryId ?? sectionId ?? null;
        if (!targetId) {
            setPath([]);
            return;
        }

        const controller = new AbortController();
        setLoading(true);

        fetch(`/api/entry/${targetId}/path`, { signal: controller.signal })
            .then(res => res.ok ? res.json() : Promise.reject())
            .then((data: BreadcrumbItem[]) => setPath(data))
            .catch(() => { /* silently ignore aborts / errors */ })
            .finally(() => setLoading(false));

        return () => controller.abort();
    }, [entryId, sectionId, monthKey, yearKey, categoryId, categoryName, categoryType]);

    // ── Close menu on outside click ─────────────────────────────────────────
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpenMenu(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ── Navigation ─────────────────────────────────────────────────────────
    const handleNavigate = useCallback((item: BreadcrumbItem) => {
        setOpenMenu(null);
        switch (item.type) {
            case 'Category':
                router.push(`/journal/${item.id}`);
                break;
            case 'Year': {
                const year = item.id.toString().replace('year-', '');
                router.push(`/journal/${categoryId}?year=${year}`);
                break;
            }
            case 'Month': {
                // id is "month-YYYY-MM"
                const monthKey = item.id.toString().replace('month-', '');
                router.push(`/journal/${categoryId}?month=${monthKey}`);
                break;
            }
            case 'Section':
                router.push(`/journal/${categoryId}?section=${item.id}`);
                break;
            case 'Page':
                router.push(`/journal/${categoryId}?entry=${item.id}`);
                break;
        }
    }, [router, categoryId]);

    // ── Dropdown: fetch siblings ────────────────────────────────────────────
    const toggleMenu = useCallback(async (itemId: string | number, item: BreadcrumbItem) => {
        if (openMenu === itemId) {
            setOpenMenu(null);
            return;
        }
        setOpenMenu(itemId);
        setMenuLoading(true);
        setMenuItems([]);

        try {
            let url = '';
            if (item.type === 'Category') {
                // Top-level entries / years for this category
                if (categoryType === 'Journal') {
                    // Show distinct years
                    const res = await fetch(`/api/entry/dates?categoryId=${categoryId}`);
                    if (res.ok) {
                        const entries = await res.json() as any[];
                        const years = [...new Set(
                            entries
                                .filter((e: any) => e.CreatedDate)
                                .map((e: any) => e.CreatedDate.substring(0, 4))
                        )].sort((a, b) => b.localeCompare(a));
                        setMenuItems(years.map(y => ({ _year: y, Title: y })));
                        setMenuLoading(false);
                        return;
                    }
                } else {
                    url = `/api/entry?categoryId=${categoryId}`;
                }
            } else if (item.type === 'Year') {
                // Show months in this year
                const year = item.id.toString().replace('year-', '');
                const res = await fetch(`/api/entry/dates?categoryId=${categoryId}&year=${year}`);
                if (res.ok) {
                    const data = await res.json() as any[];
                    setMenuItems(data.map(d => ({
                        _monthKey: d._monthKey ?? d.CreatedDate?.substring(0, 7),
                        Title: d.Title,
                    })));
                }
                setMenuLoading(false);
                return;
            } else if (item.type === 'Month') {
                // Show entries in this month
                const monthKey = item.id.toString().replace('month-', '');
                url = `/api/entry/dates?categoryId=${categoryId}&month=${monthKey}`;
            } else {
                // Section or Page — show siblings (children of parent)
                url = `/api/entry/children?parentId=${itemId}`;
            }

            if (!url) { setMenuLoading(false); return; }
            const res = await fetch(url);
            if (res.ok) {
                let data = await res.json();
                if (item.type === 'Category') {
                    data = data.filter((d: any) => !d.ParentEntryID);
                }
                setMenuItems(data);
            }
        } catch {
            // ignore
        } finally {
            setMenuLoading(false);
        }
    }, [openMenu, categoryId, categoryType]);

    // ── Render ─────────────────────────────────────────────────────────────

    // Drop the last item — it represents where we ARE, not a link to navigate to.
    const displayPath = path.length > 1 ? path.slice(0, -1) : path;
    if (displayPath.length === 0 && !loading) return null;

    const canHaveDropdown = (item: BreadcrumbItem) =>
        item.type === 'Category' ||
        item.type === 'Year' ||
        item.type === 'Month' ||
        item.type === 'Section';

    return (
        <nav className="flex items-center space-x-0.5 text-[11px] text-text-secondary overflow-x-auto no-scrollbar py-1 relative">
            {displayPath.map((item, index) => (
                <div key={`${item.type}-${item.id}`} className="flex items-center flex-shrink-0">
                    {index > 0 && <ChevronRight size={10} className="mx-0.5 text-text-muted opacity-40" />}

                    <div className="relative group">
                        <div className={`
                            flex items-center rounded-md transition-all duration-200 overflow-hidden border
                            ${openMenu === item.id
                                ? 'bg-bg-active border-border-secondary shadow-sm'
                                : 'bg-transparent border-transparent hover:bg-bg-hover hover:border-border-primary/30'}
                        `}>
                            <button
                                onClick={() => handleNavigate(item)}
                                className="flex items-center space-x-1.5 px-2 py-1.5 transition-colors hover:text-text-primary"
                            >
                                {item.type === 'Category' && <Home size={11} className="text-accent-primary" />}
                                {item.type === 'Year' && <Calendar size={11} className="text-accent-primary opacity-70" />}
                                <span className="truncate max-w-[140px]">{item.title}</span>
                            </button>

                            {canHaveDropdown(item) && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleMenu(item.id, item);
                                    }}
                                    className={`
                                        p-1.5 transition-colors flex items-center justify-center border-l border-border-primary/20
                                        ${openMenu === item.id ? 'text-accent-primary' : 'text-text-muted hover:text-text-primary'}
                                    `}
                                >
                                    <ChevronDown
                                        size={10}
                                        className={`${openMenu === item.id ? 'rotate-180' : ''} transition-transform duration-200`}
                                    />
                                </button>
                            )}
                        </div>

                        {/* Dropdown Menu */}
                        {openMenu === item.id && (
                            <div
                                ref={menuRef}
                                className="absolute top-full left-0 mt-1.5 w-64 bg-bg-card border border-border-secondary rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.5)] z-[100] py-2 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
                            >
                                <div className="max-h-72 overflow-y-auto custom-scrollbar px-1">
                                    {menuLoading ? (
                                        <div className="px-4 py-6 flex items-center justify-center space-x-2 text-text-muted">
                                            {[0, 150, 300].map(delay => (
                                                <div key={delay} className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                                            ))}
                                        </div>
                                    ) : menuItems.length === 0 ? (
                                        <div className="px-4 py-3 text-xs italic text-text-muted text-center opacity-60">
                                            No items found
                                        </div>
                                    ) : (
                                        menuItems.map((child: any, i) => {
                                            // Virtual year items (from journal Category dropdown)
                                            if (child._year) {
                                                return (
                                                    <button
                                                        key={child._year}
                                                        onClick={() => {
                                                            router.push(`/journal/${categoryId}?year=${child._year}`);
                                                            setOpenMenu(null);
                                                        }}
                                                        className="w-full text-left px-3 py-2 text-xs rounded-md hover:bg-bg-active flex items-center space-x-3 text-text-secondary hover:text-text-primary transition-all"
                                                    >
                                                        <Calendar size={14} className="text-accent-primary opacity-60 flex-shrink-0" />
                                                        <span className="truncate flex-1">{child.Title}</span>
                                                    </button>
                                                );
                                            }
                                            // Virtual month items (from journal Year dropdown)
                                            if (child._monthKey) {
                                                return (
                                                    <button
                                                        key={child._monthKey}
                                                        onClick={() => {
                                                            router.push(`/journal/${categoryId}?month=${child._monthKey}`);
                                                            setOpenMenu(null);
                                                        }}
                                                        className="w-full text-left px-3 py-2 text-xs rounded-md hover:bg-bg-active flex items-center space-x-3 text-text-secondary hover:text-text-primary transition-all"
                                                    >
                                                        <Calendar size={14} className="text-accent-primary opacity-60 flex-shrink-0" />
                                                        <span className="truncate flex-1">{child.Title}</span>
                                                    </button>
                                                );
                                            }
                                            // Real entry items (Month entries / Notebook sections & pages)
                                            return (
                                                <button
                                                    key={child.EntryID ?? i}
                                                    onClick={() => {
                                                        if (item.type === 'Month') {
                                                            // Navigate to the journal entry by date
                                                            const dateStr = child.CreatedDate?.split(' ')[0] ?? child.CreatedDate;
                                                            if (dateStr) router.push(`/journal/${categoryId}?date=${dateStr}`);
                                                        } else if (child.EntryType === 'Section') {
                                                            router.push(`/journal/${categoryId}?section=${child.EntryID}`);
                                                        } else {
                                                            router.push(`/journal/${categoryId}?entry=${child.EntryID}`);
                                                        }
                                                        setOpenMenu(null);
                                                    }}
                                                    className="w-full text-left px-3 py-2 text-xs rounded-md hover:bg-bg-active flex items-center space-x-3 text-text-secondary hover:text-text-primary transition-all group/item"
                                                >
                                                    <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                                                        {child.Icon ? (
                                                            <span className="text-sm">{child.Icon}</span>
                                                        ) : child.EntryType === 'Section' ? (
                                                            <Folder size={14} className="text-accent-primary opacity-60 group-hover/item:opacity-100 transition-opacity" />
                                                        ) : (
                                                            <File size={14} className="text-text-muted opacity-40 group-hover/item:opacity-100 transition-opacity" />
                                                        )}
                                                    </div>
                                                    <span className="truncate flex-1">{child.Title || "Untitled"}</span>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ))}

            {loading && (
                <div className="animate-pulse w-2.5 h-2.5 rounded-full bg-accent-primary opacity-20 ml-2" />
            )}
        </nav>
    );
}
