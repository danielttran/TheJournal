"use client";

import { useEffect, useState } from 'react';
import { ChevronRight, Home, Calendar } from 'lucide-react';
import { useRouter } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BreadcrumbItem {
    id: number | string;
    title: string;
    /** 'Year' and 'Month' are Journal-specific virtual levels. */
    type: 'Category' | 'Folder' | 'Page' | 'Year' | 'Month';
    categoryType?: 'Journal' | 'Notebook';
}

interface BreadcrumbsProps {
    categoryId: string;
    categoryName: string;
    categoryType: string;
    /** Editor mode — show full path including the page as the last item. */
    entryId?: number | null;
    /** Folder-grid mode — show full path with folder as the last item. */
    folderId?: number | null;
    /** Month-grid mode. */
    monthKey?: string | null;  // "YYYY-MM"
    /** Year-grid mode. */
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
    folderId,
    monthKey,
    yearKey,
}: BreadcrumbsProps) {
    const router = useRouter();
    const [path, setPath] = useState<BreadcrumbItem[]>([]);
    const [loading, setLoading] = useState(false);

    // ── Derive the breadcrumb path ──────────────────────────────────────────
    useEffect(() => {
        if (yearKey && !monthKey && !entryId && !folderId) {
            setPath(buildYearGridPath(categoryId, categoryName, categoryType, yearKey));
            return;
        }
        if (monthKey && !entryId && !folderId) {
            setPath(buildMonthGridPath(categoryId, categoryName, categoryType, monthKey));
            return;
        }

        const targetId = entryId ?? folderId ?? null;
        if (!targetId) {
            setPath([]);
            return;
        }

        const controller = new AbortController();
        setLoading(true);

        fetch(`/api/entry/${targetId}/path`, { signal: controller.signal })
            .then(res => res.ok ? res.json() : Promise.reject())
            .then((data: BreadcrumbItem[]) => setPath(data))
            .catch(() => { /* ignore aborts/errors */ })
            .finally(() => setLoading(false));

        return () => controller.abort();
    }, [entryId, folderId, monthKey, yearKey, categoryId, categoryName, categoryType]);

    // ── Navigation ─────────────────────────────────────────────────────────
    const handleNavigate = (item: BreadcrumbItem) => {
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
                const mk = item.id.toString().replace('month-', '');
                router.push(`/journal/${categoryId}?month=${mk}`);
                break;
            }
            case 'Folder':
                router.push(`/journal/${categoryId}?folder=${item.id}`);
                break;
            case 'Page':
                router.push(`/journal/${categoryId}?entry=${item.id}`);
                break;
        }
    };

    // ── Render ──────────────────────────────────────────────────────────────
    // Show the full path including the current note/folder as the last item.
    // The last item is plain non-clickable text; all ancestors are clickable
    // links. Clicking a folder ancestor navigates to its grid view (?folder=id).
    const displayPath = path;
    if (displayPath.length === 0 && !loading) return null;

    return (
        <nav className="flex items-center flex-wrap gap-0.5 text-[11px] text-text-secondary py-1 select-none">
            {displayPath.map((item, index) => {
                const isLast = index === displayPath.length - 1;

                return (
                    <div key={`${item.type}-${item.id}`} className="flex items-center flex-shrink-0">
                        {index > 0 && (
                            <ChevronRight size={10} className="mx-0.5 text-text-muted opacity-40 flex-shrink-0" />
                        )}

                        {isLast ? (
                            // Current location — plain text, no interaction
                            <span className="flex items-center space-x-1 px-2 py-1 text-text-primary font-medium">
                                {item.type === 'Category' && <Home size={11} className="text-accent-primary flex-shrink-0" />}
                                {item.type === 'Year' && <Calendar size={11} className="text-accent-primary opacity-70 flex-shrink-0" />}
                                <span className="truncate max-w-[180px]">{item.title}</span>
                            </span>
                        ) : (
                            // Ancestor — clickable link
                            <button
                                onClick={() => handleNavigate(item)}
                                className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-bg-hover hover:text-text-primary transition-colors"
                            >
                                {item.type === 'Category' && <Home size={11} className="text-accent-primary flex-shrink-0" />}
                                {item.type === 'Year' && <Calendar size={11} className="text-accent-primary opacity-70 flex-shrink-0" />}
                                <span className="truncate max-w-[140px]">{item.title}</span>
                            </button>
                        )}
                    </div>
                );
            })}

            {loading && (
                <div className="animate-pulse w-2.5 h-2.5 rounded-full bg-accent-primary opacity-20 ml-2 flex-shrink-0" />
            )}
        </nav>
    );
}
