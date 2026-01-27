"use client";

import { ReactNode } from 'react';
import { LoadingProvider } from '@/contexts/LoadingContext';
import Sidebar from '@/components/journal/Sidebar';
import Editor from '@/components/journal/Editor';
import EntryGrid from '@/components/journal/EntryGrid';

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
                <main className="flex-1 flex flex-col h-full relative">
                    {gridEntries ? (
                        <EntryGrid entries={gridEntries} title={gridTitle || ""} dataUrl={dataUrl || ""} />
                    ) : (
                        <Editor categoryId={categoryId} userId={userId} />
                    )}
                </main>
            </div>
        </LoadingProvider>
    );
}
