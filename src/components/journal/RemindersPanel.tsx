"use client";

import { useEffect, useState, useCallback } from 'react';
import { Bell, X, Check, Trash2, Plus, Calendar, Repeat } from 'lucide-react';

interface Reminder {
    ReminderID: number;
    Title: string;
    Notes: string | null;
    DueAt: string;
    IsComplete: number;
    CompletedAt: string | null;
    EntryID: number | null;
    RecurInterval: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
    RecurEvery: number | null;
}

type Filter = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed';

interface RemindersPanelProps {
    onClose: () => void;
}

export default function RemindersPanel({ onClose }: RemindersPanelProps) {
    const [items, setItems] = useState<Reminder[]>([]);
    const [filter, setFilter] = useState<Filter>('upcoming');
    const [showAdd, setShowAdd] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDue, setNewDue] = useState(() => {
        const t = new Date();
        t.setHours(t.getHours() + 1, 0, 0, 0);
        return t.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    });
    const [newNotes, setNewNotes] = useState('');
    const [newRecurInterval, setNewRecurInterval] = useState<'' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('');
    const [newRecurEvery, setNewRecurEvery] = useState(1);

    const refresh = useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await fetch(`/api/reminder?filter=${filter}`, { signal });
            if (signal?.aborted) return;
            const data = await res.json();
            if (signal?.aborted) return;
            setItems(data.items ?? []);
        } catch (err) {
            if ((err as any)?.name !== 'AbortError') throw err;
        }
    }, [filter]);

    useEffect(() => {
        const ctl = new AbortController();
        refresh(ctl.signal);
        return () => ctl.abort();
    }, [refresh]);

    const submit = async () => {
        if (!newTitle.trim()) return;
        await fetch('/api/reminder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: newTitle.trim(),
                notes: newNotes.trim() || null,
                dueAt: new Date(newDue).toISOString(),
                recurInterval: newRecurInterval || null,
                recurEvery: newRecurInterval ? newRecurEvery : null,
            }),
        });
        setNewTitle(''); setNewNotes(''); setNewRecurInterval(''); setNewRecurEvery(1); setShowAdd(false);
        refresh();
    };

    const toggle = async (id: number) => {
        await fetch(`/api/reminder/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toggle: true }),
        });
        refresh();
    };

    const remove = async (id: number) => {
        await fetch(`/api/reminder/${id}`, { method: 'DELETE' });
        refresh();
    };

    const filters: { id: Filter; label: string }[] = [
        { id: 'today', label: 'Today' },
        { id: 'upcoming', label: 'Upcoming' },
        { id: 'overdue', label: 'Overdue' },
        { id: 'completed', label: 'Done' },
        { id: 'all', label: 'All' },
    ];

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Reminders</h2>
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
                <div className="flex items-center gap-1 px-3 py-2 border-b border-border-primary overflow-x-auto">
                    {filters.map(f => (
                        <button
                            key={f.id}
                            onClick={() => setFilter(f.id)}
                            className={`px-2.5 py-1 text-xs rounded transition-colors ${filter === f.id ? 'bg-accent-primary text-white' : 'text-text-muted hover:bg-bg-hover'}`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {showAdd && (
                    <div className="p-3 border-b border-border-primary bg-bg-sidebar space-y-2">
                        <input
                            autoFocus
                            value={newTitle}
                            onChange={e => setNewTitle(e.target.value)}
                            placeholder="What needs doing?"
                            className="w-full bg-bg-card border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary"
                        />
                        <div className="flex items-center gap-2">
                            <Calendar className="w-3.5 h-3.5 text-text-muted" />
                            <input
                                type="datetime-local"
                                value={newDue}
                                onChange={e => setNewDue(e.target.value)}
                                className="bg-bg-card border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary"
                            />
                        </div>
                        <textarea
                            value={newNotes}
                            onChange={e => setNewNotes(e.target.value)}
                            placeholder="Notes (optional)"
                            className="w-full bg-bg-card border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary resize-none"
                            rows={2}
                        />
                        <div className="flex items-center gap-2">
                            <Repeat className="w-3.5 h-3.5 text-text-muted" />
                            <select
                                value={newRecurInterval}
                                onChange={e => setNewRecurInterval(e.target.value as any)}
                                className="bg-bg-card border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary"
                            >
                                <option value="">Does not repeat</option>
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                                <option value="monthly">Monthly</option>
                                <option value="yearly">Yearly</option>
                            </select>
                            {newRecurInterval && (
                                <>
                                    <span className="text-xs text-text-muted">every</span>
                                    <input
                                        type="number"
                                        min={1}
                                        value={newRecurEvery}
                                        onChange={e => setNewRecurEvery(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                        className="w-14 bg-bg-card border border-border-primary rounded px-2 py-1 text-sm text-text-primary"
                                    />
                                </>
                            )}
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowAdd(false)} className="px-3 py-1 text-xs text-text-muted hover:text-text-primary">Cancel</button>
                            <button onClick={submit} className="px-3 py-1 text-xs bg-accent-primary text-white rounded hover:opacity-90">Save</button>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                    {items.length === 0 && (
                        <div className="text-center text-text-muted py-12">
                            <Bell className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <div>No reminders here</div>
                        </div>
                    )}
                    {items.map(item => {
                        const due = new Date(item.DueAt);
                        const overdue = !item.IsComplete && due < new Date();
                        return (
                            <div key={item.ReminderID} className="group flex items-start gap-2 p-2 hover:bg-bg-hover rounded">
                                <button
                                    onClick={() => toggle(item.ReminderID)}
                                    className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${item.IsComplete ? 'bg-accent-primary border-accent-primary' : 'border-border-primary'}`}
                                >
                                    {item.IsComplete ? <Check className="w-3 h-3 text-white" /> : null}
                                </button>
                                <div className="min-w-0 flex-1">
                                    <div className={`text-sm ${item.IsComplete ? 'line-through text-text-muted' : 'text-text-primary'}`}>{item.Title}</div>
                                    <div className={`text-xs flex items-center gap-1 ${overdue ? 'text-red-400' : 'text-text-muted'}`}>
                                        {due.toLocaleString()}
                                        {item.RecurInterval && (
                                            <span className="inline-flex items-center gap-0.5 text-accent-primary">
                                                <Repeat className="w-3 h-3" />
                                                {(() => {
                                                    const n = item.RecurEvery ?? 1;
                                                    const unit = ({ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const)[item.RecurInterval];
                                                    return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
                                                })()}
                                            </span>
                                        )}
                                    </div>
                                    {item.Notes && <div className="text-xs text-text-muted mt-0.5 whitespace-pre-wrap">{item.Notes}</div>}
                                </div>
                                <button
                                    onClick={() => remove(item.ReminderID)}
                                    className="p-1 rounded hover:bg-bg-card text-red-400 opacity-0 group-hover:opacity-100"
                                    title="Delete"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
