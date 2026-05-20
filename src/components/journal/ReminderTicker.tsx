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
            Notification.requestPermission().catch(() => {});
        }
    }, []);

    useEffect(() => {
        let cancelled = false;

        const poll = async () => {
            if (inFlight.current || cancelled) return;
            inFlight.current = true;
            try {
                const res = await fetch('/api/reminder/due');
                if (!res.ok || cancelled) return;
                const data = await res.json() as { items: DueItem[] };
                const fresh = (data.items ?? []).filter(item => !seenLocally.current.has(item.ReminderID));
                if (fresh.length === 0) return;

                const canNotify = 'Notification' in window && Notification.permission === 'granted';
                for (const item of fresh) {
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
