"use client";

import { useEffect, useState, useCallback } from 'react';
import { Repeat, X, Plus, Trash2, Flame } from 'lucide-react';

interface Habit {
    HabitID: number;
    Name: string;
    Color: string;
    Goal: number;
}

interface DayStatus { date: string; logged: boolean; }
interface Streak { current: number; longest: number; }
interface HabitRow extends Habit { status: DayStatus[]; streak: Streak; }

interface HabitsPanelProps { onClose: () => void; }

const DAYS_SHOWN = 14;

function localYmd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Daily habit tracker (Tools › Habit Tracker). Click a day dot to toggle it. */
export default function HabitsPanel({ onClose }: HabitsPanelProps) {
    const [rows, setRows] = useState<HabitRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [name, setName] = useState('');
    const [color, setColor] = useState('#10b981');

    const today = localYmd(new Date());
    const rangeStart = localYmd(new Date(Date.now() - (DAYS_SHOWN - 1) * 86400000));

    const refresh = useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await fetch('/api/habit', { signal });
            if (!res.ok) return;
            const { items } = await res.json() as { items: Habit[] };
            const detailed = await Promise.all(items.map(async h => {
                const r = await fetch(`/api/habit/${h.HabitID}?start=${rangeStart}&end=${today}`, { signal });
                const d = r.ok ? await r.json() : { status: [], streak: { current: 0, longest: 0 } };
                return { ...h, status: d.status ?? [], streak: d.streak ?? { current: 0, longest: 0 } };
            }));
            if (!signal?.aborted) setRows(detailed);
        } catch (err) {
            if ((err as { name?: string })?.name !== 'AbortError') console.error('habits load failed', err);
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, [rangeStart, today]);

    useEffect(() => {
        const ctl = new AbortController();
        void refresh(ctl.signal);
        return () => ctl.abort();
    }, [refresh]);

    const addHabit = async () => {
        const n = name.trim();
        if (!n) return;
        const res = await fetch('/api/habit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: n, color }),
        });
        if (res.ok) { setName(''); setShowAdd(false); void refresh(); }
    };

    const removeHabit = async (id: number) => {
        if (!confirm('Delete this habit and its history?')) return;
        await fetch(`/api/habit/${id}`, { method: 'DELETE' });
        void refresh();
    };

    const toggleDay = async (habit: HabitRow, day: DayStatus) => {
        // Optimistic flip; refresh corrects streaks.
        setRows(prev => prev.map(r => r.HabitID === habit.HabitID
            ? { ...r, status: r.status.map(s => s.date === day.date ? { ...s, logged: !s.logged } : s) }
            : r));
        await fetch(`/api/habit/${habit.HabitID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: day.date, action: day.logged ? 'unlog' : 'log' }),
        });
        void refresh();
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <Repeat className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Habit Tracker</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-accent-primary text-white rounded hover:opacity-90">
                            <Plus className="w-3 h-3" /> New
                        </button>
                        <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {showAdd && (
                    <div className="p-3 border-b border-border-primary bg-bg-sidebar flex items-center gap-2">
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void addHabit(); }}
                            placeholder="e.g. Write every day"
                            autoFocus
                            className="flex-1 bg-bg-card border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary"
                        />
                        <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent" title="Habit color" />
                        <button onClick={() => void addHabit()} disabled={!name.trim()} className="px-3 py-1.5 text-xs bg-accent-primary text-white rounded hover:opacity-90 disabled:opacity-50">Add</button>
                        <button onClick={() => setShowAdd(false)} className="px-2 py-1.5 text-xs text-text-muted hover:text-text-primary">Cancel</button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {loading && <div className="text-center text-text-muted py-8">Loading…</div>}
                    {!loading && rows.length === 0 && (
                        <div className="text-center text-text-muted py-12">
                            <Repeat className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <div>No habits yet</div>
                            <p className="text-xs mt-1 opacity-70">Track daily habits and build streaks alongside your journal.</p>
                        </div>
                    )}
                    {rows.map(h => (
                        <div key={h.HabitID} className="p-3 border border-border-primary rounded bg-bg-sidebar">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: h.Color }} />
                                    <span className="text-sm text-text-primary font-medium truncate">{h.Name}</span>
                                </div>
                                <div className="flex items-center gap-3 flex-shrink-0">
                                    <span className="inline-flex items-center gap-1 text-xs text-text-muted" title="Current streak / longest streak">
                                        <Flame className="w-3.5 h-3.5 text-amber-500" />
                                        {h.streak.current}d <span className="opacity-60">(best {h.streak.longest}d)</span>
                                    </span>
                                    <button onClick={() => void removeHabit(h.HabitID)} className="p-1 hover:bg-bg-card rounded text-red-400" title="Delete habit">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                {h.status.map(s => (
                                    <button
                                        key={s.date}
                                        onClick={() => void toggleDay(h, s)}
                                        className="w-6 h-6 rounded text-[8px] leading-none flex items-center justify-center border transition-colors"
                                        style={s.logged
                                            ? { background: h.Color, borderColor: h.Color, color: '#fff' }
                                            : { borderColor: 'var(--color-border-primary, #444)', color: 'var(--color-text-muted, #888)' }}
                                        title={`${s.date}${s.logged ? ' — done (click to clear)' : ' — click to mark done'}`}
                                    >
                                        {parseInt(s.date.slice(8), 10)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
