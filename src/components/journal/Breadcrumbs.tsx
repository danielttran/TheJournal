"use client";

import { useEffect, useState, useRef } from 'react';
import { ChevronRight, Home, ChevronDown, Folder, File } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface BreadcrumbItem {
    id: number;
    title: string;
    type: 'Category' | 'Section' | 'Page';
    categoryType?: 'Journal' | 'Notebook';
}

interface BreadcrumbsProps {
    entryId: number | null;
    categoryId: string;
}

export default function Breadcrumbs({ entryId, categoryId }: BreadcrumbsProps) {
    const router = useRouter();
    const [path, setPath] = useState<BreadcrumbItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [openMenu, setOpenMenu] = useState<number | 'root' | null>(null);
    const [menuItems, setMenuItems] = useState<any[]>([]);
    const [menuLoading, setMenuLoading] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!entryId) {
            setPath([]);
            return;
        }

        const fetchPath = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/entry/${entryId}/path`);
                if (res.ok) {
                    const data = await res.json();
                    setPath(data);
                }
            } catch (error) {
                console.error("Breadcrumb fetch error", error);
            } finally {
                setLoading(false);
            }
        };

        fetchPath();
    }, [entryId]);

    // Close menu on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setOpenMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!entryId || path.length === 0) return null;

    const handleNavigate = (item: BreadcrumbItem) => {
        setOpenMenu(null);
        if (item.type === 'Category') {
            router.push(`/journal/${item.id}`);
        } else if (item.type === 'Section') {
            router.push(`/journal/${categoryId}?section=${item.id}`);
        } else if (item.type === 'Page') {
            router.push(`/journal/${categoryId}?entry=${item.id}`);
        }
    };

    const toggleMenu = async (id: number | 'root', type: string, catId?: number) => {
        if (openMenu === id) {
            setOpenMenu(null);
            return;
        }

        setOpenMenu(id);
        setMenuLoading(true);
        setMenuItems([]);

        try {
            let url = "";
            if (type === 'Category') {
                url = `/api/entry?categoryId=${catId}`;
            } else {
                url = `/api/entry/children?parentId=${id}`;
            }

            const res = await fetch(url);
            if (res.ok) {
                let data = await res.json();
                if (type === 'Category') {
                    // Only show top-level entries for the category dropdown
                    data = data.filter((item: any) => !item.ParentEntryID);
                }
                setMenuItems(data);
            }
        } catch (error) {
            console.error("Fetch menu items error", error);
        } finally {
            setMenuLoading(false);
        }
    };

    return (
        <nav className="flex items-center space-x-0.5 text-[11px] text-text-secondary overflow-x-auto no-scrollbar py-1 relative">
            {path.map((item, index) => (
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
                                className={`
                                    flex items-center space-x-1.5 px-2 py-1.5 transition-colors
                                    ${index === path.length - 1 ? 'text-text-primary font-bold' : 'hover:text-text-primary'}
                                `}
                            >
                                {item.type === 'Category' && <Home size={11} className="text-accent-primary" />}
                                <span className="truncate max-w-[140px]">{item.title}</span>
                            </button>

                            {item.type !== 'Page' && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleMenu(item.id, item.type, item.id as number);
                                    }}
                                    className={`
                                        p-1.5 transition-colors flex items-center justify-center border-l border-border-primary/20
                                        ${openMenu === item.id ? 'text-accent-primary' : 'text-text-muted hover:text-text-primary'}
                                    `}
                                >
                                    <ChevronDown size={10} className={`${openMenu === item.id ? 'rotate-180' : ''} transition-transform duration-200`} />
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
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                        </div>
                                    ) : menuItems.length === 0 ? (
                                        <div className="px-4 py-3 text-xs italic text-text-muted text-center opacity-60">No items found</div>
                                    ) : (
                                        menuItems.map((child: any) => (
                                            <button
                                                key={child.EntryID}
                                                onClick={() => {
                                                    if (child.EntryType === 'Section') {
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
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ))}
            {loading && <div className="animate-pulse w-2.5 h-2.5 rounded-full bg-accent-primary opacity-20 ml-2"></div>}
        </nav>
    );
}
