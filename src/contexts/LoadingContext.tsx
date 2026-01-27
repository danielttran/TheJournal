"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface LoadingState {
    entryId: number | null;
    progress: number | null; // 0-100 or null when not loading
}

interface LoadingContextType {
    loadingState: LoadingState;
    setLoading: (entryId: number, progress: number) => void;
    clearLoading: () => void;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function LoadingProvider({ children }: { children: ReactNode }) {
    const [loadingState, setLoadingState] = useState<LoadingState>({
        entryId: null,
        progress: null
    });

    const setLoading = useCallback((entryId: number, progress: number) => {
        setLoadingState({ entryId, progress });
    }, []);

    const clearLoading = useCallback(() => {
        setLoadingState({ entryId: null, progress: null });
    }, []);

    return (
        <LoadingContext.Provider value={{ loadingState, setLoading, clearLoading }}>
            {children}
        </LoadingContext.Provider>
    );
}

export function useLoading() {
    const context = useContext(LoadingContext);
    if (context === undefined) {
        throw new Error('useLoading must be used within a LoadingProvider');
    }
    return context;
}
