"use client";

import { useEffect, useRef } from 'react';

/**
 * Hook to safely subscribe to Electron IPC events with proper cleanup.
 * Uses a mounted flag pattern since Electron IPC listeners can't be removed.
 * 
 * @param eventName - The IPC event to listen for
 * @param handler - The handler function
 * @param enabled - Whether the listener is active (default: true)
 */
export function useElectronIPC<T = void>(
    eventName: 'onToggleTheme' | 'onImportDB' | 'onExportDB',
    handler: (data: T) => void,
    enabled: boolean = true
) {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined' || !window.electron) return;

        let isMounted = true;

        const listener = window.electron[eventName] as ((cb: (data?: any) => void) => void) | undefined;
        if (listener) {
            listener((data?: any) => {
                if (isMounted) {
                    handlerRef.current(data as T);
                }
            });
        }

        return () => {
            isMounted = false;
        };
    }, [eventName, enabled]);
}
