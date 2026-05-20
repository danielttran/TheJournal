"use client";

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface DueItem {
    ReminderID: number;
    Title: string;
    Notes: string | null;
    DueAt: string;
    EntryID: number | null;
    EntryCategoryID: number | null;
    ReminderType: string;
    LeadMinutes: number;
}

const POLL_INTERVAL_MS = 60_000;
// seenLocally is a soft de-dup that lets the renderer avoid double-firing a
// notification while the POST-to-mark-notified is still in flight. The server
// is the source of truth (NotifiedAt column). Cap the local set so a session
// that runs for days doesn't accumulate stale IDs forever.
const SEEN_CAP = 2000;

/**
 * Mounts once per session inside the journal layout. Every minute it asks
 * the server which reminders should fire, surfaces them via the browser's
 * Notification API (which Electron forwards to native OS notifications),
 * then tells the server to stamp NotifiedAt so the poll doesn't repeat.
 *
 * No DB access from the renderer — every call goes through the user-scoped
 * /api/reminder/due endpoint.
 */
export default function ReminderTicker() {
    const router = useRouter();
    const inFlight = useRef(false);
    const seenLocally = useRef<Set<number>>(new Set());

    useEffect(() => {
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        if (Notification.permission === 'default') {
            // requestPermission() in a useEffect is not a user gesture, so
            // Chrome may silently fail. The poll loop below still handles
            // the "denied" outcome gracefully.
            Notification.requestPermission().catch(() => {});
        }
    }, []);

    useEffect(() => {
        let cancelled = false;

        const poll = async () => {
            if (inFlight.current || cancelled) return;
            // Short-circuit: if the user denied notifications, no point
            // hitting the DB every minute — we'd never fire a popup.
            if (typeof window !== 'undefined'
                && 'Notification' in window
                && Notification.permission === 'denied') {
                return;
            }
            inFlight.current = true;
            try {
                const res = await fetch('/api/reminder/due');
                if (!res.ok || cancelled) return;
                const data = await res.json() as { items: DueItem[] };
                const fresh = (data.items ?? []).filter(item => !seenLocally.current.has(item.ReminderID));
                if (fresh.length === 0) return;

                const canNotify = 'Notification' in window && Notification.permission === 'granted';
                for (const item of fresh) {
                    // Trim oldest entries (Set iteration order is insertion order)
                    // if we're over the cap, so long sessions don't leak memory.
                    if (seenLocally.current.size >= SEEN_CAP) {
                        const oldest = seenLocally.current.values().next().value;
                        if (oldest !== undefined) seenLocally.current.delete(oldest);
                    }
                    seenLocally.current.add(item.ReminderID);
                    if (canNotify) {
                        try {
                            const n = new Notification(item.Title || 'Reminder', {
                                body: item.Notes || (item.DueAt ? `Due ${new Date(item.DueAt).toLocaleString()}` : ''),
                                tag: `tj-reminder-${item.ReminderID}`,
                            });
                            if (item.EntryID && item.EntryCategoryID) {
                                n.onclick = () => {
                                    window.focus();
                                    router.push(`/journal/${item.EntryCategoryID}?entry=${item.EntryID}`);
                                };
                            }
                        } catch { /* notifications can throw if the page lost focus mid-call */ }
                    }
                }

                // Tell the server to mark these notified so the next poll skips them.
                await fetch('/api/reminder/due', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reminderIds: fresh.map(f => f.ReminderID) }),
                }).catch(() => {});
            } catch {
                /* swallow — poll on the next tick */
            } finally {
                inFlight.current = false;
            }
        };

        // Run once at mount, then every minute.
        poll();
        const handle = window.setInterval(poll, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(handle);
        };
    }, [router]);

    return null;
}
