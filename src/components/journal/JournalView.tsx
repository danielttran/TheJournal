"use client";

import { useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoadingProvider } from '@/contexts/LoadingContext';
import Sidebar from '@/components/journal/Sidebar';
import Editor from '@/components/journal/Editor';
import EntryGrid from '@/components/journal/EntryGrid';
import SearchPanel from '@/components/journal/SearchPanel';
import Breadcrumbs from '@/components/journal/Breadcrumbs';

interface JournalViewProps {
    categoryId: string;
    userId: string;
    categoryName: string;
    categoryType: string;
    viewSettings?: string;
    gridEntries?: any[] | null;
    gridTitle?: string;
    dataUrl?: string;
    gridMode?: 'section' | 'journal-month' | 'journal-year';
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
}: JournalViewProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isSplitMode, setIsSplitMode] = useState(false);
    const [showSearch, setShowSearch] = useState(false);

    const toggleSplitMode = useCallback(() => setIsSplitMode(v => !v), []);
    const openSearch = useCallback(() => setShowSearch(true), []);
    const closeSearch = useCallback(() => setShowSearch(false), []);

    const handleSearchNavigate = useCallback((targetCategoryId: number, entryId: number, _categoryType: string) => {
        router.push(`/journal/${targetCategoryId}?entry=${entryId}`);
    }, [router]);

    // Derive breadcrumb context from URL for grid views
    const sectionId = searchParams.get('section') ? parseInt(searchParams.get('section')!, 10) : null;
    const monthKey  = searchParams.get('month')   ?? null;
    const yearKey   = searchParams.get('year')    ?? null;
    const isGridView = !!gridEntries;

    return (
        <LoadingProvider>
            <div className="flex h-full bg-bg-app text-text-primary overflow-hidden font-sans transition-colors duration-200">
                <Sidebar
                    categoryId={categoryId}
                    userId={userId}
                    title={categoryName}
                    type={categoryType}
                    viewSettings={viewSettings}
                />
                <main className="flex-1 flex flex-col h-full min-w-0">
                    {/* Breadcrumb bar — shown in grid views (editor view manages its own inside its header) */}
                    {isGridView && (
                        <div className="h-10 border-b border-border-primary flex items-center px-4 bg-bg-sidebar flex-shrink-0">
                            <Breadcrumbs
                                categoryId={categoryId}
                                categoryName={categoryName}
                                categoryType={categoryType}
                                sectionId={sectionId}
                                monthKey={monthKey}
                                yearKey={yearKey}
                            />
                        </div>
                    )}

                    {isGridView ? (
                        <EntryGrid
                            entries={gridEntries!}
                            title={gridTitle || ""}
                            dataUrl={dataUrl || ""}
                            categoryId={categoryId}
                            gridMode={gridMode}
                        />
                    ) : (
                        <Editor
                            categoryId={categoryId}
                            categoryName={categoryName}
                            categoryType={categoryType}
                            userId={userId}
                            onEnterSplitMode={toggleSplitMode}
                            isSplitMode={isSplitMode}
                            onOpenSearch={openSearch}
                        />
                    )}
                </main>

                {showSearch && (
                    <SearchPanel
                        currentCategoryId={categoryId}
                        currentCategoryType={categoryType}
                        onClose={closeSearch}
                        onNavigate={handleSearchNavigate}
                    />
                )}
            </div>
        </LoadingProvider>
    );
}
