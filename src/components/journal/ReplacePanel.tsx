"use client";

import { useState } from 'react';
import { Replace, X } from 'lucide-react';

interface Props {
    categoryId: number;
    onClose: () => void;
}

export default function ReplacePanel({ categoryId, onClose }: Props) {
    const [find, setFind] = useState('');
    const [replace, setReplace] = useState('');
    const [matchCase, setMatchCase] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [preview, setPreview] = useState<{ Title: string; EntryID: number; count: number }[] | null>(null);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<{ entries: number; replacements: number } | null>(null);

    const runPreview = async () => {
        if (!find) return;
        setBusy(true);
        const res = await fetch('/api/search/replace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId, find, replace, matchCase, wholeWord, preview: true }),
        });
        const data = await res.json();
        setPreview(data.affected);
        setTotal(data.totalReplacements);
        setBusy(false);
    };

    const runExecute = async () => {
        if (!find) return;
        if (!confirm(`Replace ${total} occurrence(s) across ${preview?.length ?? 0} entries? This cannot be undone.`)) return;
        setBusy(true);
        const res = await fetch('/api/search/replace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId, find, replace, matchCase, wholeWord, preview: false }),
        });
        const data = await res.json();
        setDone({ entries: data.totalEntriesChanged, replacements: data.totalReplacements });
        setPreview(null);
        setBusy(false);
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[560px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <Replace className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Find &amp; Replace</h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-4 space-y-3">
                    <input value={find} onChange={e => setFind(e.target.value)} placeholder="Find" autoFocus
                        className="w-full bg-bg-sidebar border border-border-primary rounded px-3 py-2 text-sm text-text-primary" />
                    <input value={replace} onChange={e => setReplace(e.target.value)} placeholder="Replace with"
                        className="w-full bg-bg-sidebar border border-border-primary rounded px-3 py-2 text-sm text-text-primary" />
                    <div className="flex items-center gap-4 text-xs text-text-muted">
                        <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={matchCase} onChange={e => setMatchCase(e.target.checked)} />
                            Match case
                        </label>
                        <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={wholeWord} onChange={e => setWholeWord(e.target.checked)} />
                            Whole word
                        </label>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button onClick={runPreview} disabled={busy || !find} className="px-3 py-1.5 text-sm bg-bg-sidebar border border-border-primary rounded text-text-primary hover:bg-bg-hover disabled:opacity-50">
                            Preview
                        </button>
                        <button onClick={runExecute} disabled={busy || !preview || preview.length === 0} className="px-3 py-1.5 text-sm bg-accent-primary text-white rounded hover:opacity-90 disabled:opacity-50">
                            Replace all
                        </button>
                    </div>
                </div>
                {done && (
                    <div className="px-4 pb-4 text-sm text-text-primary">
                        Replaced {done.replacements} occurrence(s) in {done.entries} entry(ies).
                    </div>
                )}
                {preview && (
                    <div className="border-t border-border-primary px-4 py-2 flex-1 overflow-y-auto">
                        <div className="text-xs text-text-muted mb-2">
                            {total} occurrence(s) in {preview.length} entries
                        </div>
                        {preview.map(p => (
                            <div key={p.EntryID} className="flex items-center justify-between text-sm py-1">
                                <span className="truncate text-text-primary">{p.Title || 'Untitled'}</span>
                                <span className="text-text-muted text-xs ml-2 flex-shrink-0">{p.count}×</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
