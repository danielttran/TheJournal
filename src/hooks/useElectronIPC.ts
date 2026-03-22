"use client";

import { useEffect, useRef } from 'react';

/**
 * Hook to safely subscribe to Electron IPC events with proper cleanup.
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

    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined' || !window.electron) return;

        const listener = window.electron[eventName] as ((cb: (data?: unknown) => void) => (() => void) | void) | undefined;
        const unsubscribe = listener?.((data?: unknown) => {
            handlerRef.current(data as T);
        });

        return () => {
            unsubscribe?.();
        };
    }, [eventName, enabled]);
}
