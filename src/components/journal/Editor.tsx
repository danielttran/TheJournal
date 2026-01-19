"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef } from 'react';
import 'react-quill-new/dist/quill.snow.css'; // Add css for snow theme
import { useSearchParams } from 'next/navigation';

// Dynamic import to avoid SSR issues with Quill
const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

export default function Editor({ categoryId, userId }: { categoryId: string, userId: string }) {
    const searchParams = useSearchParams();
    const urlDate = searchParams.get('date');
    const selectedDate = urlDate || new Date().toISOString().split('T')[0];
    const urlEntryId = searchParams.get('entry') ? parseInt(searchParams.get('entry')!, 10) : null;

    const [value, setValue] = useState(''); // HTML/Content
    const [entryId, setEntryId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const valueRef = useRef(value); // Tracking for unmount save
    const entryIdRef = useRef(entryId); // Tracking for unmount save

    useEffect(() => {
        valueRef.current = value;
    }, [value]);

    useEffect(() => {
        entryIdRef.current = entryId;
    }, [entryId]);

    // Save Function
    const saveContent = async (id: number, content: string) => {
        setSaving(true);
        try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            const plainText = tempDiv.textContent || tempDiv.innerText || '';
            const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
            // Limit preview to ~200 chars
            const derivedPreview = plainText.substring(0, 200);

            await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    content: { ops: [{ insert: content }] },
                    html: content,
                    title: derivedTitle,
                    preview: derivedPreview
                })
            });
        } catch (err) {
            console.error("Failed to save", err);
        } finally {
            setSaving(false);
            window.dispatchEvent(new CustomEvent('journal-entry-updated'));
        }
    };

    // Debounce Save Logic
    useEffect(() => {
        if (!entryId || !value) return;

        const timer = setTimeout(() => {
            saveContent(entryId, value);
        }, 1500);

        return () => clearTimeout(timer);
    }, [value, entryId, userId]);

    // Initial Load
    useEffect(() => {
        const fetchEntry = async () => {
            setValue('');
            setEntryId(null);

            // Prioritize URL Entry ID (Notebook Mode)
            if (urlEntryId) {
                try {
                    const res = await fetch(`/api/entry/${urlEntryId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.EntryID) {
                            setEntryId(data.EntryID);
                            if (data.HtmlContent) setValue(data.HtmlContent);
                        }
                    }
                } catch (e) {
                    console.error(e);
                }
                return;
            }

            try {
                const res = await fetch('/api/entry/by-date', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        date: selectedDate,
                        categoryId,
                        userId
                    })
                });
                const data = await res.json();
                if (data.id) {
                    setEntryId(data.id);
                    if (data.html) setValue(data.html);
                } else {
                    setValue('');
                }
            } catch (err) {
                console.error("Failed to load entry", err);
            }
        };
        fetchEntry();
    }, [categoryId, userId, selectedDate, urlEntryId]);

    // Unmount / Change Save Logic
    useEffect(() => {
        return () => {
            if (entryIdRef.current && valueRef.current) {
                // Use Beacon or sync XHR if possible for unmount reliability?
                // But fetch usually works in modern browsers if not cancelled.
                saveContent(entryIdRef.current, valueRef.current);
            }
        };
    }, []); // Run on unmount only? 
    // Actually, we need to save when switching entries too.
    // The previous logic saved when dependencies changed.

    // Let's split it:
    // 1. Save on ID change (switching entries)
    useEffect(() => {
        const currentId = entryIdRef.current;
        const val = valueRef.current;
        return () => {
            // When this effect cleans up (before running next, or on unmount),
            // We check if we need to save.
            // IMPORTANT: entryIdRef matches the ID *before* the change.
            if (currentId && val) {
                saveContent(currentId, val);
            }
        }
    }, [urlEntryId, selectedDate]); // When these change, we are effectively 'unmounting' the current entry context


    // Modules for custom toolbar
    const modules = {
        toolbar: [
            [{ 'header': [1, 2, false] }],
            ['bold', 'italic', 'underline', 'strike', 'blockquote'],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
            ['link', 'image'],
            ['clean']
        ],
    };

    return (
        <div className="flex flex-col h-full bg-bg-app transition-colors duration-200">
            {/* Top Toolbar Status Only */}
            <div className="h-8 border-b border-border-primary flex items-center justify-end px-4 bg-bg-app absolute top-0 right-0 z-50 pointer-events-none">
                {/* Status Indicator floating */}
                <span className={`text-xs flex items-center transition-colors ${saving ? 'text-yellow-500' : 'text-green-500'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saving ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
                    {saving ? 'Saving...' : 'Saved'}
                </span>
            </div>

            {/* Editor Area - Toolbar will be injected by Quill at top */}
            <div className="flex-1 overflow-hidden relative flex flex-col">
                <ReactQuill
                    key={entryId || 'empty'}
                    theme="snow"
                    value={value}
                    onChange={setValue}
                    modules={modules}
                    className="flex-1 flex flex-col bg-transparent border-none"
                    placeholder="Start writing..."
                />
            </div>

            <style jsx global>{`
                /* Custom overrides to match the theme aesthetics */
                .ql-toolbar {
                    border: none !important;
                    border-bottom: 1px solid var(--border-primary) !important;
                    background: var(--bg-card);
                    color: var(--text-primary);
                    padding: 12px 24px !important;
                    transition: background-color 0.2s, border-color 0.2s;
                }
                .ql-container {
                    border: none !important;
                    font-size: 1.125rem;
                    flex: 1;
                    overflow: hidden; 
                    display: flex;
                    flex-direction: column;
                }
                .ql-editor {
                    flex: 1;
                    overflow-y: auto;
                    padding: 2rem 4rem !important; /* Spacious padding */
                    color: var(--text-primary);
                }
                .ql-editor.ql-blank::before {
                    color: var(--text-muted) !important;
                    opacity: 0.6;
                    font-style: italic;
                }
                .ql-editor:focus.ql-blank::before {
                    display: none !important;
                }
                .ql-editor p {
                     margin-bottom: 0.8em;
                     line-height: 1.6;
                }
                .ql-stroke {
                    stroke: var(--text-secondary) !important;
                    fill: none !important; 
                }
                .ql-fill {
                    fill: var(--text-secondary) !important;
                    stroke: none !important; 
                }
                .ql-picker {
                    color: var(--text-secondary) !important;
                }
                .ql-picker-options {
                    background-color: var(--bg-card) !important;
                    border: 1px solid var(--border-primary) !important;
                    color: var(--text-primary) !important;
                }
                .quill {
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                }
            `}</style>
        </div>
    );
}
