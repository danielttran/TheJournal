"use client";

import { useEffect } from 'react';

/**
 * Close a dialog/popup when the user presses Escape — the universal expectation
 * for modal surfaces. Every modal in the app pairs this with backdrop-click
 * dismissal so all of them behave the same way.
 *
 * @param onClose - called when Escape is pressed while enabled
 * @param enabled - whether the listener is active (default: true). Pass the
 *   modal's own open flag for modals that stay mounted while closed.
 */
export function useEscapeToClose(onClose: () => void, enabled: boolean = true) {
    useEffect(() => {
        if (!enabled) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                // Stop other Escape listeners (e.g. the editor's distraction-free
                // toggle) from also reacting to this keypress.
                e.stopPropagation();
                onClose();
            }
        };
        // Capture phase so the modal wins the Escape before deeper handlers.
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose, enabled]);
}
