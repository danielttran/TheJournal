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

    const [value, setValue] = useState('');
    const [entryId, setEntryId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);

    // Refs for Data Safety (The "Truth" outside React render cycle)
    const contentRef = useRef('');
    const entryIdRef = useRef<number | null>(null);
    const isDirtyRef = useRef(false);

    // Sync refs with state
    useEffect(() => { entryIdRef.current = entryId; }, [entryId]);

    // Core Save Function - The "Cannot Fail" Logic
    const performSave = async (id: number, content: string, isAutoSave = false) => {
        // Validation precaution
        if (!content && !isAutoSave) {
            // Allow saving empty if explicit? checking context.
        }

        if (!isAutoSave) {
            console.log(`[Editor] Force saving ID: ${id}, Content Len: ${content.length}`);
        } else {
            setSaving(true);
        }

        try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            const plainText = tempDiv.textContent || tempDiv.innerText || '';
            const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
            const derivedPreview = plainText.substring(0, 200);

            const res = await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true, // Critical for navigation survival
                body: JSON.stringify({
                    userId,
                    content: { ops: [{ insert: content }] },
                    html: content,
                    title: derivedTitle,
                    preview: derivedPreview
                })
            });

            if (res.ok) {
                console.log(`[Editor] Save Success for ${id}. Dispatching Update Event.`);
                // Notify app AFTER successful save (fixes stale thumbs)
                window.dispatchEvent(new CustomEvent('journal-entry-updated'));
                isDirtyRef.current = false;
            } else {
                console.error(`[Editor] Save Failed: ${res.status}`);
            }

        } catch (err) {
            console.error("[Editor] Network/Save Error", err);
        } finally {
            if (isAutoSave) setSaving(false);
        }
    };

    // 1. Text Change Handler
    const handleChange = (content: string) => {
        setValue(content);
        // Only mark dirty if it actually changed meaningfully? 
        // For now, any change is dirty.
        if (contentRef.current !== content) {
            contentRef.current = content;
            if (!isDirtyRef.current) {
                console.log("[Editor] Marked Dirty");
                isDirtyRef.current = true;
            }
        }
    };

    // 2. Auto-Save Timer (Debounce)
    useEffect(() => {
        const timer = setTimeout(() => {
            if (isDirtyRef.current && entryIdRef.current) {
                performSave(entryIdRef.current, contentRef.current, true);
            }
        }, 1000);
        return () => clearTimeout(timer);
    }, [value]);

    // 3. Navigation / Unmount Safety Net
    // We capture the ID in a local variable to ensure we save the RIGHT entry on unmount
    useEffect(() => {
        // Capture the ACTIVE ID when this effect is mounted (which is for a specific entry context)
        // Wait, dependencies are [urlEntryId, selectedDate].
        // This effect runs whenever navigation targets change.

        return () => {
            // Cleanup runs BEFORE the next effect cycle.
            // We check the mutable refs.
            const idToSave = entryIdRef.current;
            const contentToSave = contentRef.current;
            const wasDirty = isDirtyRef.current;

            console.log(`[Editor] Navigation Cleanup Check. Dirty: ${wasDirty}, ID: ${idToSave}`);

            if (wasDirty && idToSave) {
                performSave(idToSave, contentToSave, false);
            }
        };
    }, [urlEntryId, selectedDate]);

    // Initial Load Logic
    useEffect(() => {
        const fetchEntry = async () => {
            // ... Logic to load entry ...
            // Important: We must not clear ref if we are about to save it?
            // No, the PREVIOUS effect cleanup ran first. So it's safe to reset here.

            // Temporary local vars to prevent race conditions with state
            let loadedId: number | null = null;
            let loadedContent = '';

            try {
                // ... fetch logic ...
                if (urlEntryId) {
                    const res = await fetch(`/api/entry/${urlEntryId}`);
                    if (res.ok) {
                        const data = await res.json();
                        loadedId = data.EntryID;
                        loadedContent = data.HtmlContent || '';
                    }
                } else {
                    const res = await fetch('/api/entry/by-date', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ date: selectedDate, categoryId, userId })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        loadedId = data.id;
                        loadedContent = data.html || '';
                    }
                }
            } catch (err) {
                console.error("Failed to load", err);
            }

            // Batch updates
            setValue(loadedContent);
            setEntryId(loadedId); // This triggers the ref update effect
            contentRef.current = loadedContent;
            isDirtyRef.current = false;
        };
        fetchEntry();
    }, [categoryId, userId, selectedDate, urlEntryId]);

    // Toolbar Modules
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
            <div className="h-8 border-b border-border-primary flex items-center justify-end px-4 bg-bg-app absolute top-0 right-0 z-50 pointer-events-none">
                <span className={`text-xs flex items-center transition-colors ${saving ? 'text-yellow-500' : 'text-green-500'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saving ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
                    {saving ? 'Saving...' : 'Saved'}
                </span>
            </div>

            <div className="flex-1 overflow-hidden relative flex flex-col">
                <ReactQuill
                    key={entryId || 'loading'}
                    theme="snow"
                    value={value}
                    onChange={handleChange}
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
