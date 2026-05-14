"use client";

import { useEffect, useState, useCallback } from 'react';
import { Scissors, X, Plus, Trash2, Copy } from 'lucide-react';

interface Snippet {
    SnippetID: number;
    Name: string;
    Content: string;
    Shortcut: string | null;
}

interface Props {
    onClose: () => void;
    onInsert?: (html: string) => void;
}

export default function SnippetsPanel({ onClose, onInsert }: Props) {
    const [items, setItems] = useState<Snippet[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [newName, setNewName] = useState('');
    const [newContent, setNewContent] = useState('');
    const [newShortcut, setNewShortcut] = useState('');

    const refresh = useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await fetch('/api/snippet', { signal });
            if (signal?.aborted) return;
            const data = await res.json();
            if (signal?.aborted) return;
            setItems(data.items ?? []);
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
        if (!newName.trim() || !newContent.trim()) return;
        await fetch('/api/snippet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: newName.trim(),
                content: newContent.trim(),
                shortcut: newShortcut.trim() || null,
            }),
        });
        setNewName(''); setNewContent(''); setNewShortcut(''); setShowAdd(false);
        refresh();
    };

    const remove = async (id: number) => {
        await fetch(`/api/snippet/${id}`, { method: 'DELETE' });
        refresh();
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <Scissors className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Snippets</h2>
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
                        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" autoFocus
                            className="w-full bg-bg-card border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary" />
                        <input value={newShortcut} onChange={e => setNewShortcut(e.target.value)} placeholder="Shortcut (e.g. ;sig)"
                            className="w-full bg-bg-card border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary" />
                        <textarea value={newContent} onChange={e => setNewContent(e.target.value)} rows={4}
                            placeholder="Content (HTML or plain text)"
                            className="w-full bg-bg-card border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary resize-none" />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowAdd(false)} className="px-3 py-1 text-xs text-text-muted hover:text-text-primary">Cancel</button>
                            <button onClick={submit} className="px-3 py-1 text-xs bg-accent-primary text-white rounded hover:opacity-90">Save</button>
                        </div>
                    </div>
                )}
                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                    {items.length === 0 && !showAdd && (
                        <div className="text-center text-text-muted py-12">
                            <Scissors className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <div>No snippets yet</div>
                        </div>
                    )}
                    {items.map(s => (
                        <div key={s.SnippetID} className="group flex items-center gap-2 p-2 hover:bg-bg-hover rounded">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-text-primary font-medium">{s.Name}</span>
                                    {s.Shortcut && <code className="text-[10px] text-text-muted bg-bg-active rounded px-1">{s.Shortcut}</code>}
                                </div>
                                <div className="text-xs text-text-muted truncate" dangerouslySetInnerHTML={{ __html: s.Content }} />
                            </div>
                            {onInsert && (
                                <button onClick={() => { onInsert(s.Content); onClose(); }} className="p-1 rounded hover:bg-bg-card text-accent-primary" title="Insert">
                                    <Copy className="w-3.5 h-3.5" />
                                </button>
                            )}
                            <button onClick={() => remove(s.SnippetID)} className="p-1 rounded hover:bg-bg-card text-red-400 opacity-0 group-hover:opacity-100">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
