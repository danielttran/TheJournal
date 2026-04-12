"use client";

import { useEffect, useRef } from 'react';
import type { ElectronViewAction } from '@/lib/types';

/** All subscribable Electron IPC event names exposed by the preload. */
export type ElectronIPCEvent =
    | 'onToggleTheme'
    | 'onImportDB'
    | 'onExportDB'
    | 'onLogoutRequest'
    | 'onOpenSettings'
    | 'onViewAction';

// Map each event name to the data type its callback receives
type ElectronIPCEventData = {
    onToggleTheme: void;
    onImportDB: string;      // filePath
    onExportDB: void;
    onLogoutRequest: void;
    onOpenSettings: void;
    onViewAction: ElectronViewAction;
};

/**
 * Safely subscribes to an Electron IPC event with automatic cleanup.
 * No-op when running in a browser (window.electron is absent).
 *
 * @param eventName - Which IPC subscription to attach to
 * @param handler   - Callback invoked when the event fires
 * @param enabled   - Whether the subscription is active (default: true)
 */
export function useElectronIPC<K extends ElectronIPCEvent>(
    eventName: K,
    handler: (data: ElectronIPCEventData[K]) => void,
    enabled: boolean = true
) {
    // Keep a stable ref so the subscription never needs to re-register when
    // the handler identity changes (avoids remove/add churn on every render).
    const handlerRef = useRef(handler);
    useEffect(() => { handlerRef.current = handler; }, [handler]);

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined' || !window.electron) return;

        const subscribe = window.electron[eventName] as
            | ((cb: (data?: unknown) => void) => (() => void) | void)
            | undefined;

        const unsubscribe = subscribe?.((data?: unknown) => {
            handlerRef.current(data as ElectronIPCEventData[K]);
        });

        return () => { unsubscribe?.(); };
    }, [eventName, enabled]);
}
