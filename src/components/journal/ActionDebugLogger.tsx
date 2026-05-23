"use client";

import { useEffect } from 'react';
import { actionDebugEnabled } from '@/lib/actionLog';

/**
 * Central action monitor: logs EVERY `trigger-*` window event (menu items,
 * context menu, keyboard commands, Electron menu bridge, plugin runs all flow
 * through these), so any action is traceable in the console. Patches
 * window.dispatchEvent once; restores on unmount.
 */
export default function ActionDebugLogger() {
    useEffect(() => {
        const w = window as Window & { __tjDispatchPatched?: boolean };
        if (w.__tjDispatchPatched) return;
        w.__tjDispatchPatched = true;

        const original = window.dispatchEvent.bind(window);
        const patched: typeof window.dispatchEvent = (event: Event) => {
            try {
                if (actionDebugEnabled() && typeof event?.type === 'string' && event.type.startsWith('trigger-')) {
                    const detail = (event as CustomEvent).detail;
                    // eslint-disable-next-line no-console
                    console.debug('%c[TJ event]', 'color:#14b8a6;font-weight:bold', event.type, detail ?? '');
                }
            } catch { /* never let logging break dispatch */ }
            return original(event);
        };
        window.dispatchEvent = patched;

        return () => {
            window.dispatchEvent = original;
            w.__tjDispatchPatched = false;
        };
    }, []);

    return null;
}
