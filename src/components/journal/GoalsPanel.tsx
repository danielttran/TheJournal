"use client";

import { useEffect, useState, useCallback } from 'react';
import { Target, X, Plus, Trash2 } from 'lucide-react';

interface Goal {
    WordGoalID: number;
    Type: 'daily' | 'total';
    Target: number;
    StartDate: string;
    EndDate: string | null;
    CategoryID: number | null;
    current: number;
    percent: number;
}

interface GoalsPanelProps {
    onClose: () => void;
}

export default function GoalsPanel({ onClose }: GoalsPanelProps) {
    const [goals, setGoals] = useState<Goal[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [type, setType] = useState<'daily' | 'total'>('daily');
    const [target, setTarget] = useState(500);
    const [endDate, setEndDate] = useState('');
    // Minimum words per entry (0 = off) — persisted as a user setting; the
    // editor footer shows a "to go" hint while an entry is below it.
    const [minWords, setMinWords] = useState(0);
    const [minWordsSaved, setMinWordsSaved] = useState(false);

    useEffect(() => {
        const ctl = new AbortController();
        fetch('/api/settings', { signal: ctl.signal })
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d || ctl.signal.aborted) return;
                const n = parseInt(d?.settings?.minWordsPerEntry ?? '0', 10);
                setMinWords(Number.isFinite(n) && n > 0 ? n : 0);
            })
            .catch(() => {});
        return () => ctl.abort();
    }, []);

    const saveMinWords = async (n: number) => {
        // Cap matches the settings route's validation (7 digits) so the panel
        // can't display a value the server rejected.
        const safe = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 9_999_999) : 0;
        setMinWords(safe);
        const res = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'minWordsPerEntry', value: String(safe) }),
        });
        if (res.ok) {
            window.dispatchEvent(new CustomEvent('min-words-changed', { detail: safe }));
            setMinWordsSaved(true);
            setTimeout(() => setMinWordsSaved(false), 1500);
        } else {
            // Re-sync from the server rather than showing an unsaved value.
            const cur = await fetch('/api/settings').then(r => r.ok ? r.json() : null).catch(() => null);
            const m = parseInt(cur?.settings?.minWordsPerEntry ?? '0', 10);
            setMinWords(Number.isFinite(m) && m > 0 ? m : 0);
        }
    };

    const refresh = useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await fetch('/api/wordgoal', { signal });
            if (signal?.aborted) return;
            const data = await res.json();
            if (signal?.aborted) return;
            setGoals(data.goals ?? []);
        } catch (err) {
            if ((err as { name?: string })?.name !== 'AbortError') throw err;
        }
    }, []);

    useEffect(() => {
        const ctl = new AbortController();
        refresh(ctl.signal);
        return () => ctl.abort();
    }, [refresh]);

    const submit = async () => {
        const today = new Date().toISOString().slice(0, 10);
        await fetch('/api/wordgoal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type,
                target,
                startDate: today,
                endDate: type === 'total' && endDate ? endDate : null,
            }),
        });
        setShowAdd(false);
        refresh();
    };

    const remove = async (id: number) => {
        await fetch(`/api/wordgoal/${id}`, { method: 'DELETE' });
        refresh();
    };

    const presetNanowrimo = () => {
        const yr = new Date().getFullYear();
        setType('total');
        setTarget(50000);
        setEndDate(`${yr}-11-30`);
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[560px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Word Goals</h2>
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
                    <div className="p-3 border-b border-border-primary bg-bg-sidebar space-y-2">
                        <div className="flex gap-2">
                            <button onClick={() => setType('daily')} className={`flex-1 px-3 py-1.5 text-sm rounded ${type === 'daily' ? 'bg-accent-primary text-white' : 'bg-bg-card border border-border-primary'}`}>Daily</button>
                            <button onClick={() => setType('total')} className={`flex-1 px-3 py-1.5 text-sm rounded ${type === 'total' ? 'bg-accent-primary text-white' : 'bg-bg-card border border-border-primary'}`}>Total</button>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-text-muted">Target words:</label>
                            <input type="number" value={target} onChange={e => setTarget(parseInt(e.target.value, 10) || 0)} className="flex-1 bg-bg-card border border-border-primary rounded px-2 py-1 text-sm text-text-primary" />
                        </div>
                        {type === 'total' && (
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-text-muted">End date:</label>
                                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="flex-1 bg-bg-card border border-border-primary rounded px-2 py-1 text-sm text-text-primary" />
                                <button onClick={presetNanowrimo} className="text-[10px] text-accent-primary hover:underline">NaNoWriMo</button>
                            </div>
                        )}
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowAdd(false)} className="px-3 py-1 text-xs text-text-muted hover:text-text-primary">Cancel</button>
                            <button onClick={submit} className="px-3 py-1 text-xs bg-accent-primary text-white rounded hover:opacity-90">Save</button>
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-2 px-3 py-2 border-b border-border-primary bg-bg-sidebar/60">
                    <label className="text-xs text-text-muted whitespace-nowrap">Minimum words per entry:</label>
                    <input
                        type="number"
                        min="0"
                        value={minWords || ''}
                        placeholder="off"
                        onChange={e => void saveMinWords(parseInt(e.target.value, 10) || 0)}
                        className="w-20 bg-bg-card border border-border-primary rounded px-2 py-1 text-sm text-text-primary"
                    />
                    <span className="text-[10px] text-text-muted">{minWordsSaved ? 'Saved' : '0 = off · shown in the editor footer'}</span>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {goals.length === 0 && (
                        <div className="text-center text-text-muted py-12">
                            <Target className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <div>No active goals</div>
                        </div>
                    )}
                    {goals.map(g => (
                        <div key={g.WordGoalID} className="p-3 border border-border-primary rounded bg-bg-sidebar">
                            <div className="flex items-center justify-between mb-1">
                                <div className="text-sm text-text-primary font-medium">
                                    {g.Type === 'daily' ? 'Daily' : 'Total'} · {g.Target.toLocaleString()} words
                                </div>
                                <button onClick={() => remove(g.WordGoalID)} className="p-1 hover:bg-bg-card rounded text-red-400" title="Delete">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <div className="text-xs text-text-muted mb-2">
                                {g.current.toLocaleString()} / {g.Target.toLocaleString()} ({g.percent.toFixed(1)}%)
                                {g.EndDate && <span> · ends {g.EndDate}</span>}
                            </div>
                            <div className="h-2 bg-bg-card rounded overflow-hidden">
                                <div
                                    className="h-full bg-accent-primary transition-all"
                                    style={{ width: `${Math.min(100, g.percent)}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
