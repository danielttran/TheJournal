"use client";

import { useEffect, useRef, useCallback } from 'react';
import { logout } from '@/app/actions';
import { shouldLockForIdle } from '@/lib/idleLock';

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
    'mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel', 'pointerdown', 'focus',
];

const IDLE_TICK_MS = 30_000;

/**
 * Mounts once inside the journal layout. Owns three lock triggers:
 *   1. Idle-timer (renderer side) — reads `idleLockMinutes` from settings.
 *   2. The security.lock command (default Ctrl+Shift+L) — dispatched by the
 *      command registry as `trigger-lock-app`, so user rebinds apply and the
 *      dispatcher's defaultPrevented guard stops an editor-consumed keystroke
 *      from also locking.
 *   3. Electron 'lock-app' IPC — fires when the user minimizes and
 *      `lockOnMinimize` is enabled in settings.
 *
 * Locking just calls the existing server action `logout()`, which clears
 * the session cookie and redirects to /login. This intentionally relies on
 * the cookie-only session — there's no in-memory plaintext to clear.
 */
export default function LockGate() {
    const lastActivityRef = useRef<number>(Date.now());
    const idleMinutesRef = useRef<number>(0);
    const isLockingRef = useRef(false);

    const lock = useCallback(async () => {
        if (isLockingRef.current) return;
        isLockingRef.current = true;
        try {
            await logout();
        } catch {
            // logout() redirects via Next, so a thrown NEXT_REDIRECT is expected.
        }
    }, []);

    // Load idle-lock setting; refresh on settings save events.
    useEffect(() => {
        const load = async () => {
            try {
                let raw: unknown = 0;
                if (typeof window !== 'undefined' && window.electron?.getSettings) {
                    const s = await window.electron.getSettings();
                    raw = s?.idleLockMinutes ?? 0;
                } else if (typeof window !== 'undefined') {
                    // Web: settings live in localStorage under 'app-settings'.
                    const settingsStr = localStorage.getItem('app-settings');
                    if (settingsStr) {
                        try {
                            const parsed = JSON.parse(settingsStr) as { idleLockMinutes?: unknown };
                            raw = parsed.idleLockMinutes ?? 0;
                        } catch { /* fall through */ }
                    }
                }
                const n = Number(raw);
                idleMinutesRef.current = Number.isFinite(n) && n > 0 ? n : 0;
            } catch { /* silence */ }
        };
        load();
        const onSettingsChanged = () => { load(); };
        window.addEventListener('settings-changed', onSettingsChanged);
        return () => window.removeEventListener('settings-changed', onSettingsChanged);
    }, []);

    // Track user activity. Throttled — we only update the ref, no React state.
    useEffect(() => {
        const markActive = () => { lastActivityRef.current = Date.now(); };
        for (const ev of ACTIVITY_EVENTS) {
            window.addEventListener(ev, markActive, { passive: true });
        }
        return () => {
            for (const ev of ACTIVITY_EVENTS) {
                window.removeEventListener(ev, markActive);
            }
        };
    }, []);

    // Idle tick.
    useEffect(() => {
        const handle = window.setInterval(() => {
            if (shouldLockForIdle(idleMinutesRef.current, lastActivityRef.current, Date.now())) {
                lock();
            }
        }, IDLE_TICK_MS);
        return () => window.clearInterval(handle);
    }, [lock]);

    // Rapid lock command (security.lock via the command registry).
    useEffect(() => {
        const onLock = () => { void lock(); };
        window.addEventListener('trigger-lock-app', onLock);
        return () => window.removeEventListener('trigger-lock-app', onLock);
    }, [lock]);

    // Electron minimize-lock IPC.
    useEffect(() => {
        if (typeof window === 'undefined' || !window.electron?.onLockApp) return;
        const unsubscribe = window.electron.onLockApp(() => lock());
        return () => { unsubscribe?.(); };
    }, [lock]);

    return null;
}
