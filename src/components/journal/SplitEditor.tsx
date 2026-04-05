"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, X, ChevronDown, Check } from 'lucide-react';
import { format } from 'date-fns';
import hljs from 'highlight.js';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const ReactQuill = dynamic(async () => {
    const { default: RQ, Quill } = await import('react-quill-new');

    if (typeof window !== 'undefined') {
        window.hljs = hljs;
        window.katex = katex;
    }

    const BlockEmbed = Quill.import('blots/block/embed') as any;
    const Link = Quill.import('formats/link') as any;
    const Size = Quill.import('attributors/style/size') as any;
    Size.whitelist = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '22px', '24px', '26px', '28px', '36px', '48px', '72px'];
    Quill.register(Size as any, true);

    class CustomVideo extends BlockEmbed {
        static create(value: string) {
            const node = super.create();
            node.setAttribute('frameborder', '0');
            node.setAttribute('allowfullscreen', 'true');
            node.setAttribute('src', Link.sanitize(value));
            return node;
        }
        static value(node: any) { return node.getAttribute('src'); }
    }
    (CustomVideo as any).blotName = 'video';
    (CustomVideo as any).tagName = 'iframe';
    (CustomVideo as any).className = 'ql-video';
    Quill.register(CustomVideo as any, true);

    return RQ;
}, { ssr: false });

interface EntryOption {
    id: number;
    label: string;
}

interface SplitEditorProps {
    categoryId: string;
    userId: string;
    categoryType: string;
    onClose: () => void;
}

export default function SplitEditor({ categoryId, userId, categoryType, onClose }: SplitEditorProps) {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [selectedLabel, setSelectedLabel] = useState('');
    const [entries, setEntries] = useState<EntryOption[]>([]);
    const [showPicker, setShowPicker] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);

    const quillRef = useRef<any>(null);
    const isDirtyRef = useRef(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const currentIdRef = useRef<number | null>(null);
    const isLoadedRef = useRef(false);
    const contentRef = useRef('');
    const deltaRef = useRef<any>(null);
    // Track server version for optimistic locking — prevents split view from silently
    // overwriting changes made in the main editor (or another tab) since load.
    const versionRef = useRef<number | null>(null);
    // Guard setState calls after unmount
    const isMountedRef = useRef(true);
    useEffect(() => { return () => { isMountedRef.current = false; }; }, []);

    // Fetch entry list for picker
    useEffect(() => {
        const endpoint = categoryType === 'Journal'
            ? `/api/entry/dates?categoryId=${categoryId}`
            : `/api/entry?categoryId=${categoryId}`;

        fetch(endpoint)
            .then(r => r.json())
            .then((data: any[]) => {
                if (!Array.isArray(data) || !isMountedRef.current) return;
                const options: EntryOption[] = data
                    .filter(e => categoryType !== 'Notebook' || e.EntryType === 'Page')
                    .map(e => ({
                        id: e.EntryID,
                        label: categoryType === 'Journal' && e.CreatedDate
                            ? format(new Date(e.CreatedDate), 'MMMM d, yyyy') + (e.Title && e.Title !== 'New Entry' ? ` — ${e.Title}` : '')
                            : (e.Title || 'Untitled'),
                    }));
                setEntries(options);
            })
            .catch(() => { });
    }, [categoryId, categoryType]);

    const performSave = useCallback(async () => {
        if (!currentIdRef.current || !isDirtyRef.current) return;
        if (isMountedRef.current) { setSaving(true); setSaveError(false); }

        const id = currentIdRef.current;
        const delta = deltaRef.current;
        const html = contentRef.current;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html || '';
        const plainText = tempDiv.textContent || '';
        const title = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
        const preview = plainText.substring(0, 200);

        try {
            const res = await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: delta, html, title, preview,
                    expectedVersion: versionRef.current ?? undefined,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.version) versionRef.current = data.version;
                isDirtyRef.current = false;
                window.dispatchEvent(new CustomEvent('journal-entry-updated'));
                if (isMountedRef.current) setSaveError(false);
            } else if (res.status === 409) {
                // Version conflict — another session modified this entry; signal the user
                console.warn('[SplitEditor] Version conflict on save — entry was modified elsewhere');
                if (isMountedRef.current) setSaveError(true);
            } else {
                if (isMountedRef.current) setSaveError(true);
            }
        } catch {
            if (isMountedRef.current) setSaveError(true);
        } finally {
            if (isMountedRef.current) setSaving(false);
        }
    }, [userId]);

    // On unmount: use sendBeacon for reliability (fetch is aborted on navigation).
    // This mirrors the primary Editor's beforeunload strategy.
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            if (!isDirtyRef.current || !currentIdRef.current) return;

            const id = currentIdRef.current;
            const delta = deltaRef.current;
            const html = contentRef.current;

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html || '';
            const plainText = tempDiv.textContent || '';
            const body = {
                content: delta,
                html,
                title: plainText.split('\n')[0].substring(0, 100) || 'Untitled',
                preview: plainText.substring(0, 200),
            };

            const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
            if (!navigator.sendBeacon(`/api/entry/${id}`, blob)) {
                // sendBeacon unavailable — fall back to synchronous XHR
                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', `/api/entry/${id}`, false);
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.send(JSON.stringify(body));
                } catch { }
            }
        };
    }, [userId]);

    // Load content into Quill once it mounts.
    // Quill is only rendered after selectedId is set, so there is a render-cycle gap
    // between setSelectedId() and the ref becoming available. We retry with a short
    // interval and guard with the targetId so a quick double-click can't corrupt state.
    const tryLoadContent = useCallback((targetId: number, delta: any, html: string) => {
        if (!isMountedRef.current) return;            // component unmounted — stop retry loop
        if (currentIdRef.current !== targetId) return; // user switched away

        if (!quillRef.current) {
            setTimeout(() => tryLoadContent(targetId, delta, html), 50);
            return;
        }

        try {
            const quill = quillRef.current.getEditor();
            if (delta?.ops) {
                quill.setContents(delta, 'api');
            } else if (html) {
                quill.clipboard.dangerouslyPasteHTML(html, 'api');
            }
            contentRef.current = quill.root.innerHTML;
            deltaRef.current = quill.getContents();
        } catch { }

        isLoadedRef.current = true;
    }, []);

    const loadEntry = useCallback(async (id: number, label: string) => {
        // Flush unsaved changes from the previous entry before switching
        if (isDirtyRef.current && currentIdRef.current) {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            await performSave();
        }

        if (isMountedRef.current) {
            setSelectedId(id);
            setSelectedLabel(label);
            setShowPicker(false);
            setSearchQuery('');
        }
        currentIdRef.current = id;
        isLoadedRef.current = false;
        isDirtyRef.current = false;
        versionRef.current = null; // reset until we get a fresh version from the server

        // Clear editor immediately to avoid stale content flash
        if (quillRef.current) {
            try { quillRef.current.getEditor().setText(''); } catch { }
        }

        try {
            const res = await fetch(`/api/entry/${id}`);
            if (!res.ok || currentIdRef.current !== id) return; // entry switched mid-fetch
            const data = await res.json();

            // Capture version for optimistic locking
            if (data.Version) versionRef.current = data.Version;

            let loadedDelta: any = null;
            if (data.QuillDelta) {
                try { loadedDelta = typeof data.QuillDelta === 'string' ? JSON.parse(data.QuillDelta) : data.QuillDelta; } catch { }
            }

            // tryLoadContent retries until Quill is mounted, guards against switched entries
            tryLoadContent(id, loadedDelta, data.HtmlContent || '');
        } catch { }
    }, [performSave, tryLoadContent]);

    const handleChange = useCallback((_content: string, _delta: any, source: string, editor: any) => {
        contentRef.current = editor.getHTML();
        deltaRef.current = editor.getContents();

        if (source === 'user' && isLoadedRef.current) {
            isDirtyRef.current = true;
            if (isMountedRef.current) setSaveError(false);
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = setTimeout(performSave, 1000);
        }
    }, [performSave]);

    const filteredEntries = useMemo(() => {
        if (!searchQuery.trim()) return entries;
        const q = searchQuery.toLowerCase();
        return entries.filter(e => e.label.toLowerCase().includes(q));
    }, [entries, searchQuery]);

    const modules = useMemo(() => ({
        toolbar: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ color: [] }, { background: [] }],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['link', 'blockquote', 'code-block'],
            ['clean'],
        ],
    }), []);

    return (
        <div className="flex flex-col h-full bg-bg-app relative">
            {/* Header */}
            <div className="h-10 border-b border-border-primary flex items-center px-3 gap-2 bg-bg-sidebar flex-shrink-0">
                <button
                    onClick={() => setShowPicker(v => !v)}
                    className="flex items-center gap-1 flex-1 min-w-0 text-sm text-text-primary hover:text-accent-primary transition-colors"
                    title="Switch entry"
                >
                    <span className="truncate">{selectedLabel || 'Choose an entry…'}</span>
                    <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" />
                </button>
                <span className={`text-[10px] uppercase font-semibold flex items-center gap-1 flex-shrink-0 ${saveError ? 'text-red-500' : saving ? 'text-yellow-500' : selectedId ? 'text-green-500' : 'text-text-muted'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${saveError ? 'bg-red-500' : saving ? 'bg-yellow-500 animate-pulse' : selectedId ? 'bg-green-500' : 'bg-text-muted'}`} />
                    {saveError ? 'Error' : saving ? 'Saving' : selectedId ? 'Saved' : ''}
                </span>
                <button
                    onClick={onClose}
                    className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-red-400 flex-shrink-0 transition-colors"
                    title="Close split view (Ctrl+\)"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Entry picker dropdown */}
            {showPicker && (
                <div className="absolute top-10 left-0 right-0 z-20 bg-bg-card border-b border-border-primary shadow-xl">
                    <div className="p-2 border-b border-border-primary">
                        <div className="flex items-center gap-2 px-2 py-1.5 border border-border-primary rounded bg-bg-active">
                            <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                            <input
                                autoFocus
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Escape' && selectedId) setShowPicker(false);
                                    if (e.key === 'Enter' && filteredEntries.length === 1) {
                                        loadEntry(filteredEntries[0].id, filteredEntries[0].label);
                                    }
                                }}
                                placeholder="Search entries…"
                                className="flex-1 bg-transparent text-sm text-text-primary focus:outline-none placeholder:text-text-muted"
                            />
                        </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                        {filteredEntries.length === 0 ? (
                            <div className="text-center py-6 text-text-muted text-sm">No entries found</div>
                        ) : (
                            filteredEntries.map(e => (
                                <button
                                    key={e.id}
                                    onClick={() => loadEntry(e.id, e.label)}
                                    className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm text-text-secondary hover:text-text-primary flex items-center gap-2 transition-colors"
                                >
                                    <span className="w-4 flex-shrink-0 flex items-center justify-center">
                                        {e.id === selectedId && <Check className="w-3.5 h-3.5 text-accent-primary" />}
                                    </span>
                                    <span className="truncate">{e.label}</span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Prompt when no entry picked yet */}
            {!selectedId && !showPicker && (
                <div className="flex-1 flex items-center justify-center">
                    <button
                        onClick={() => setShowPicker(true)}
                        className="text-sm text-text-muted hover:text-accent-primary transition-colors"
                    >
                        Click to choose an entry
                    </button>
                </div>
            )}

            {/* Quill editor — only rendered once an entry is selected */}
            {selectedId && (
                <div
                    className="flex-1 overflow-hidden flex flex-col min-h-0"
                    onClick={() => showPicker && setShowPicker(false)}
                >
                    <style>{`
                        .split-pane .ql-container.ql-snow {
                            border: none !important;
                            display: flex !important;
                            flex-direction: column;
                            flex: 1;
                            min-height: 0;
                            overflow: hidden;
                            height: 100% !important;
                        }
                        .split-pane .ql-editor {
                            flex: 1;
                            overflow-y: auto;
                            height: 100%;
                        }
                        .split-pane .ql-toolbar { flex-shrink: 0; }
                    `}</style>
                    <div className="split-pane flex-1 flex flex-col min-h-0">
                        <ReactQuill
                            // @ts-expect-error — react-quill-new ref typings
                            ref={quillRef}
                            theme="snow"
                            defaultValue={''}
                            onChange={handleChange}
                            modules={modules}
                            className="flex-1 flex flex-col bg-transparent border-none min-h-0"
                            placeholder="Start writing…"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
