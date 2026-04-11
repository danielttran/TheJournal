"use client";

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingProvider } from '@/contexts/LoadingContext';
import Sidebar from '@/components/journal/Sidebar';
import Editor from '@/components/journal/Editor';
import EntryGrid from '@/components/journal/EntryGrid';
import SearchPanel from '@/components/journal/SearchPanel';

interface JournalViewProps {
    categoryId: string;
    userId: string;
    categoryName: string;
    categoryType: string;
    viewSettings?: string;
    gridEntries?: any[] | null;
    gridTitle?: string;
    dataUrl?: string;
}

export default function JournalView({
    categoryId,
    userId,
    categoryName,
    categoryType,
    viewSettings,
    gridEntries,
    gridTitle,
    dataUrl
}: JournalViewProps) {
    const router = useRouter();
    const [isSplitMode, setIsSplitMode] = useState(false);
    const [showSearch, setShowSearch] = useState(false);

    const toggleSplitMode = useCallback(() => setIsSplitMode(v => !v), []);
    const openSearch = useCallback(() => setShowSearch(true), []);
    const closeSearch = useCallback(() => setShowSearch(false), []);

    const handleSearchNavigate = useCallback((targetCategoryId: number, entryId: number, _categoryType: string) => {
        router.push(`/journal/${targetCategoryId}?entry=${entryId}`);
    }, [router]);

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
                    {gridEntries ? (
                        <EntryGrid entries={gridEntries} title={gridTitle || ""} dataUrl={dataUrl || ""} />
                    ) : (
                        <Editor
                            categoryId={categoryId}
                            userId={userId}
                            onEnterSplitMode={toggleSplitMode}
                            isSplitMode={isSplitMode}
                            onOpenSearch={openSearch}
                        />
                    )}
                </main>

                {/* Search panel — rendered at root so it overlays the editor */}
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
