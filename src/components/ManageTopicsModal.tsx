"use client";

import { useEffect, useState, useCallback } from 'react';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

interface TopicRow { TopicID: number; Name: string; }

export default function ManageTopicsModal({ onClose }: { onClose: () => void }) {
    useEscapeToClose(onClose);
    const [topics, setTopics] = useState<TopicRow[]>([]);
    const [name, setName] = useState('');
    const [color, setColor] = useState('#6366f1');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const res = await fetch('/api/topic');
        if (res.ok) setTopics(await res.json());
    }, []);

    useEffect(() => { void load(); }, [load]);

    const add = async () => {
        if (!name.trim()) return;
        setError(null);
        setBusy(true);
        try {
            const res = await fetch('/api/topic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), color }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setError(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`); return; }
            setName('');
            await load();
        } finally { setBusy(false); }
    };

    const remove = async (id: number, label: string) => {
        if (!confirm(`Delete topic "${label}"? It will be removed from all entries.`)) return;
        const res = await fetch(`/api/topic/${id}`, { method: 'DELETE' });
        if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || `HTTP ${res.status}`); return; }
        await load();
    };

    return (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl p-5 w-[400px]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-text-primary">Manage Topics</h2>
                    <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg leading-none">×</button>
                </div>

                <ul className="mb-4 max-h-48 overflow-y-auto divide-y divide-border-primary">
                    {topics.map(t => (
                        <li key={t.TopicID} className="flex items-center justify-between py-1.5 text-sm">
                            <span className="text-text-primary">{t.Name}</span>
                            <button onClick={() => remove(t.TopicID, t.Name)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                        </li>
                    ))}
                    {topics.length === 0 && <li className="py-2 text-xs text-text-muted">No topics yet.</li>}
                </ul>

                <div className="border-t border-border-primary pt-3 space-y-2">
                    <div className="text-xs uppercase tracking-wider text-text-muted">Add topic</div>
                    <div className="flex items-center gap-2">
                        <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 w-10 bg-transparent border border-border-primary rounded cursor-pointer" title="Topic color" />
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="Topic name"
                            onKeyDown={e => { if (e.key === 'Enter') void add(); }}
                            className="flex-1 p-2 text-sm bg-bg-app border border-border-primary rounded text-text-primary outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]" />
                    </div>
                    {error && <div className="text-xs text-red-400">{error}</div>}
                    <div className="flex justify-end">
                        <button onClick={add} disabled={busy} className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90 disabled:opacity-50">Add topic</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
