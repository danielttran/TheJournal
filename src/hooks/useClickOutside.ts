"use client";

import { useEffect, RefObject } from 'react';

/**
 * Hook to detect clicks outside of a referenced element.
 * Calls the callback when a click occurs outside.
 * 
 * @param ref - React ref to the element to detect clicks outside of
 * @param callback - Function to call when click outside is detected
 * @param enabled - Whether the listener is active (default: true)
 */
export function useClickOutside<T extends HTMLElement>(
    ref: RefObject<T | null>,
    callback: () => void,
    enabled: boolean = true
) {
    useEffect(() => {
        if (!enabled) return;

        function handleClickOutside(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                callback();
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [ref, callback, enabled]);
}
