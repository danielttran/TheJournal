"use client";

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoadingProvider } from '@/contexts/LoadingContext';
import Sidebar from '@/components/journal/Sidebar';
import Editor from '@/components/journal/Editor';
import EntryGrid from '@/components/journal/EntryGrid';
import SearchPanel from '@/components/journal/SearchPanel';
import Breadcrumbs from '@/components/journal/Breadcrumbs';
import ErrorBoundary from '@/components/ErrorBoundary';
import SmartbookView from '@/components/journal/SmartbookView';
import CategorySettingsModal from '@/components/journal/CategorySettingsModal';

interface JournalViewProps {
    categoryId: string;
    userId: string;
    categoryName: string;
    categoryType: string;
    viewSettings?: string;
    // GridEntryRow shapes from the server have `Icon`/`PreviewText` as nullable,
    // and the year view inserts synthetic month rows without ParentEntryID.
    // Accept a permissive shape and let EntryGrid coerce where needed.
    gridEntries?: ({
        EntryID: number;
        Title: string;
        CreatedDate?: string;
        Icon?: string | null;
        PreviewText?: string | null;
        EntryType?: string;
        SortOrder?: number;
        _monthKey?: string;
    })[] | null;
    gridTitle?: string;
    dataUrl?: string;
    gridMode?: 'section' | 'journal-month' | 'journal-year';
    isSmartbook?: boolean;
}

export default function JournalView({
    categoryId,
    userId,
    categoryName,
    categoryType,
    viewSettings,
    gridEntries,
    gridTitle,
    dataUrl,
    gridMode = 'section',
    isSmartbook = false,
}: JournalViewProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isSplitMode, setIsSplitMode] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    // "Find…" scopes to the current category; "Search Across All Categories…"
    // opens the same panel pre-scoped to all categories.
    const [searchScope, setSearchScope] = useState<'all' | 'current'>('current');
    // Bumped on every open-search action so an already-mounted panel re-scopes.
    const [searchScopeSeq, setSearchScopeSeq] = useState(0);
    const [showSmartbookSettings, setShowSmartbookSettings] = useState(false);

    const [showDatePicker, setShowDatePicker] = useState(false);
    const [datePickerValue, setDatePickerValue] = useState('');
    const [sidebarHidden, setSidebarHidden] = useState(false);
    const [sidebarSide, setSidebarSide] = useState<'left' | 'right'>('left');

    // David RM "Sidebar Layout" — persisted show/hide + left/right position.
    useEffect(() => {
        try {
            setSidebarHidden(localStorage.getItem('sidebarHidden') === '1');
            setSidebarSide(localStorage.getItem('sidebarSide') === 'right' ? 'right' : 'left');
        } catch { /* ignore */ }
        const onToggle = () => setSidebarHidden(v => {
            const next = !v;
            try { localStorage.setItem('sidebarHidden', next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
        const onSide = () => setSidebarSide(v => {
            const next = v === 'left' ? 'right' : 'left';
            try { localStorage.setItem('sidebarSide', next); } catch { /* ignore */ }
            return next;
        });
        const setSide = (side: 'left' | 'right') => {
            setSidebarHidden(false);
            setSidebarSide(side);
            try { localStorage.setItem('sidebarHidden', '0'); localStorage.setItem('sidebarSide', side); } catch { /* ignore */ }
        };
        const onLeft = () => setSide('left');
        const onRight = () => setSide('right');
        const onHidden = () => { setSidebarHidden(true); try { localStorage.setItem('sidebarHidden', '1'); } catch { /* ignore */ } };
        const onRefresh = () => window.location.reload();
        const setCategoryType = async (type: 'Journal' | 'Notebook') => {
            try {
                await fetch(`/api/category/${categoryId}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type }),
                });
                router.refresh();
            } catch { /* ignore */ }
        };
        const onCalendar = () => setCategoryType('Journal');
        const onLooseleaf = () => setCategoryType('Notebook');
        window.addEventListener('trigger-toggle-sidebar', onToggle);
        window.addEventListener('trigger-sidebar-side', onSide);
        window.addEventListener('trigger-sidebar-left', onLeft);
        window.addEventListener('trigger-sidebar-right', onRight);
        window.addEventListener('trigger-sidebar-hidden', onHidden);
        window.addEventListener('trigger-refresh', onRefresh);
        window.addEventListener('trigger-category-calendar', onCalendar);
        window.addEventListener('trigger-category-looseleaf', onLooseleaf);
        return () => {
            window.removeEventListener('trigger-toggle-sidebar', onToggle);
            window.removeEventListener('trigger-sidebar-side', onSide);
            window.removeEventListener('trigger-sidebar-left', onLeft);
            window.removeEventListener('trigger-sidebar-right', onRight);
            window.removeEventListener('trigger-sidebar-hidden', onHidden);
            window.removeEventListener('trigger-refresh', onRefresh);
            window.removeEventListener('trigger-category-calendar', onCalendar);
            window.removeEventListener('trigger-category-looseleaf', onLooseleaf);
        };
    }, [categoryId, router]);

    const toggleSplitMode = useCallback(() => setIsSplitMode(v => !v), []);
    const openSearch = useCallback(() => { setSearchScope('current'); setSearchScopeSeq(s => s + 1); setShowSearch(true); }, []);
    const closeSearch = useCallback(() => setShowSearch(false), []);

    // "Search Across All Categories…" opens the search panel pre-scoped to all.
    useEffect(() => {
        const onSearchAll = () => { setSearchScope('all'); setSearchScopeSeq(s => s + 1); setShowSearch(true); };
        window.addEventListener('trigger-search-all', onSearchAll);
        return () => window.removeEventListener('trigger-search-all', onSearchAll);
    }, []);

    const localToday = useCallback(() => {
        const d = new Date();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
    }, []);

    // David RM "Go" menu: today / go-to-date / browser-style back & forward.
    // Triggered by keyboard (CommandDispatcher) or the Electron Go menu, both
    // of which dispatch the same trigger-* window events.
    useEffect(() => {
        const goToday = () => router.push(`/journal/${categoryId}?date=${localToday()}`);
        const openDate = () => { setDatePickerValue(searchParams.get('date') || localToday()); setShowDatePicker(true); };
        const back = () => window.history.back();
        const forward = () => window.history.forward();
        // F3 / "Find Next" drive the in-entry find bar (handled in Editor); the
        // global cross-entry search panel stays on Ctrl+F (trigger-search).
        window.addEventListener('trigger-go-today', goToday);
        window.addEventListener('trigger-go-to-date', openDate);
        window.addEventListener('trigger-history-back', back);
        window.addEventListener('trigger-history-forward', forward);
        return () => {
            window.removeEventListener('trigger-go-today', goToday);
            window.removeEventListener('trigger-go-to-date', openDate);
            window.removeEventListener('trigger-history-back', back);
            window.removeEventListener('trigger-history-forward', forward);
        };
    }, [router, categoryId, searchParams, localToday]);

    const submitDate = useCallback(() => {
        if (datePickerValue) router.push(`/journal/${categoryId}?date=${datePickerValue}`);
        setShowDatePicker(false);
    }, [datePickerValue, router, categoryId]);

    const handleSearchNavigate = useCallback((targetCategoryId: number, entryId: number, _categoryType: string) => {
        router.push(`/journal/${targetCategoryId}?entry=${entryId}`);
    }, [router]);

    // Derive breadcrumb context from URL for grid views
    const folderId = searchParams.get('folder') ? parseInt(searchParams.get('folder')!, 10) : null;
    const monthKey  = searchParams.get('month')   ?? null;
    const yearKey   = searchParams.get('year')    ?? null;
    const isGridView = !!gridEntries;

    if (isSmartbook) {
        return (
            <LoadingProvider>
                <div className="flex h-full bg-bg-app text-text-primary overflow-hidden font-sans transition-colors duration-200">
                    <main className="flex-1 flex flex-col h-full min-w-0">
                        <SmartbookView
                            categoryId={categoryId}
                            categoryName={categoryName}
                            onOpenSettings={() => setShowSmartbookSettings(true)}
                        />
                    </main>
                    {showSmartbookSettings && (
                        <CategorySettingsModal
                            categoryId={parseInt(categoryId, 10)}
                            onClose={() => setShowSmartbookSettings(false)}
                            onSaved={() => router.refresh()}
                        />
                    )}
                </div>
            </LoadingProvider>
        );
    }

    return (
        <LoadingProvider>
            <div className="flex h-full bg-bg-app text-text-primary overflow-hidden font-sans transition-colors duration-200">
                {!sidebarHidden && sidebarSide === 'left' && (
                    <Sidebar
                        categoryId={categoryId}
                        userId={userId}
                        title={categoryName}
                        type={categoryType}
                        viewSettings={viewSettings}
                    />
                )}
                <main className="flex-1 flex flex-col h-full min-w-0">
                    {/* Breadcrumb bar — shown in grid views (editor view manages its own inside its header) */}
                    {isGridView && (
                        <div className="h-10 border-b border-border-primary flex items-center px-4 bg-bg-sidebar flex-shrink-0">
                            <Breadcrumbs
                                categoryId={categoryId}
                                categoryName={categoryName}
                                categoryType={categoryType}
                                folderId={folderId}
                                monthKey={monthKey}
                                yearKey={yearKey}
                            />
                        </div>
                    )}

                    {isGridView ? (
                        <ErrorBoundary
                            fallback={
                                <div className="p-6 text-text-secondary text-sm">
                                    Failed to render entries. Try reloading the page.
                                </div>
                            }
                        >
                            <EntryGrid
                                entries={gridEntries as never as import('@/lib/types').Entry[]}
                                title={gridTitle || ""}
                                dataUrl={dataUrl || ""}
                                categoryId={categoryId}
                                gridMode={gridMode}
                            />
                        </ErrorBoundary>
                    ) : (
                        <ErrorBoundary
                            fallback={
                                <div className="p-6 text-text-secondary text-sm">
                                    The editor crashed. Your last save is intact — reload to recover.
                                </div>
                            }
                        >
                            <Editor
                                categoryId={categoryId}
                                categoryName={categoryName}
                                categoryType={categoryType}
                                userId={userId}
                                onEnterSplitMode={toggleSplitMode}
                                isSplitMode={isSplitMode}
                                onOpenSearch={openSearch}
                            />
                        </ErrorBoundary>
                    )}
                </main>

                {!sidebarHidden && sidebarSide === 'right' && (
                    <Sidebar
                        categoryId={categoryId}
                        userId={userId}
                        title={categoryName}
                        type={categoryType}
                        viewSettings={viewSettings}
                    />
                )}

                {showSearch && (
                    <ErrorBoundary
                        fallback={
                            <div className="w-96 border-l border-border-primary p-4 text-text-secondary text-sm">
                                Search failed to render.
                            </div>
                        }
                    >
                        <SearchPanel
                            currentCategoryId={categoryId}
                            currentCategoryType={categoryType}
                            initialScope={searchScope}
                            scopeRequestSeq={searchScopeSeq}
                            onClose={closeSearch}
                            onNavigate={handleSearchNavigate}
                        />
                    </ErrorBoundary>
                )}

                {showDatePicker && (
                    <div
                        className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40"
                        onClick={() => setShowDatePicker(false)}
                    >
                        <div
                            className="bg-bg-card border border-border-primary rounded-lg shadow-2xl p-4 w-[280px]"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="text-sm font-medium text-text-primary mb-2">Go to date</div>
                            <input
                                type="date"
                                value={datePickerValue}
                                autoFocus
                                onChange={e => setDatePickerValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') submitDate(); if (e.key === 'Escape') setShowDatePicker(false); }}
                                className="w-full p-2 text-sm bg-bg-app border border-border-primary rounded text-text-primary outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]"
                            />
                            <div className="flex justify-end gap-2 mt-3">
                                <button onClick={() => setShowDatePicker(false)} className="px-3 py-1.5 text-sm rounded text-text-muted hover:bg-bg-hover">Cancel</button>
                                <button onClick={submitDate} className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90">Go</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </LoadingProvider>
    );
}
