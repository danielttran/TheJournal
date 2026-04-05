"use client";

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingProvider } from '@/contexts/LoadingContext';
import Sidebar from '@/components/journal/Sidebar';
import Editor from '@/components/journal/Editor';
import EntryGrid from '@/components/journal/EntryGrid';
import SplitEditor from '@/components/journal/SplitEditor';
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
    // Ratio is the percentage width of the primary (left) pane; clamped 25–75.
    const [splitRatio, setSplitRatio] = useState(50);
    const containerRef = useRef<HTMLDivElement>(null);
    // Track the active entry in the primary pane so split view can pre-load it.
    const currentEntryIdRef = useRef<number | null>(null);
    const [splitInitialEntryId, setSplitInitialEntryId] = useState<number | null>(null);

    const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();

        const onMouseMove = (e: MouseEvent) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const ratio = ((e.clientX - rect.left) / rect.width) * 100;
            setSplitRatio(Math.max(25, Math.min(75, ratio)));
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.removeProperty('cursor');
            document.body.style.removeProperty('user-select');
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, []);

    const handleEntryChange = useCallback((id: number | null) => {
        currentEntryIdRef.current = id;
    }, []);

    const toggleSplitMode = useCallback(() => {
        setSplitInitialEntryId(currentEntryIdRef.current);
        setIsSplitMode(v => !v);
    }, []);
    const exitSplitMode = useCallback(() => setIsSplitMode(false), []);
    const openSearch = useCallback(() => setShowSearch(true), []);
    const closeSearch = useCallback(() => setShowSearch(false), []);

    // Navigate to a search result via URL — Editor already responds to ?entry=ID
    // for both Journal and Notebook entry types.
    const handleSearchNavigate = useCallback((targetCategoryId: number, entryId: number, _categoryType: string) => {
        router.push(`/journal/${targetCategoryId}?entry=${entryId}`);
    }, [router]);

    return (
        <LoadingProvider>
            <div className="flex h-screen bg-bg-app text-text-primary overflow-hidden font-sans transition-colors duration-200">
                <Sidebar
                    categoryId={categoryId}
                    userId={userId}
                    title={categoryName}
                    type={categoryType}
                    viewSettings={viewSettings}
                />
                <div ref={containerRef} className="flex-1 flex h-full min-w-0">
                    {/* Primary pane */}
                    <main
                        className="flex flex-col h-full relative min-w-0"
                        style={{ width: isSplitMode && !gridEntries ? `${splitRatio}%` : '100%' }}
                    >
                        {gridEntries ? (
                            <EntryGrid entries={gridEntries} title={gridTitle || ""} dataUrl={dataUrl || ""} />
                        ) : (
                            <Editor
                                categoryId={categoryId}
                                userId={userId}
                                onEnterSplitMode={toggleSplitMode}
                                isSplitMode={isSplitMode}
                                onOpenSearch={openSearch}
                                onEntryChange={handleEntryChange}
                            />
                        )}
                    </main>

                    {/* Resize divider */}
                    {isSplitMode && !gridEntries && (
                        <div
                            onMouseDown={handleDividerMouseDown}
                            className="w-1 bg-border-primary hover:bg-accent-primary cursor-col-resize flex-shrink-0 transition-colors relative group"
                            title="Drag to resize"
                        >
                            {/* Wider invisible hit area */}
                            <div className="absolute inset-y-0 -left-2 -right-2" />
                        </div>
                    )}

                    {/* Secondary pane */}
                    {isSplitMode && !gridEntries && (
                        <main className="flex flex-col h-full relative min-w-0 flex-1">
                            <SplitEditor
                                categoryId={categoryId}
                                userId={userId}
                                categoryType={categoryType}
                                onClose={exitSplitMode}
                                initialEntryId={splitInitialEntryId}
                            />
                        </main>
                    )}
                </div>

                {/* Search panel — rendered at root so it overlays both panes */}
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
