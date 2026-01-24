"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useMemo } from 'react';
import hljs from 'highlight.js';
import 'react-quill-new/dist/quill.snow.css'; // Add css for snow theme
import 'highlight.js/styles/atom-one-dark.css'; // Syntax highlighting theme
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useSearchParams } from 'next/navigation';

// ... other imports
import Breadcrumbs from './Breadcrumbs';

// Dynamic import to avoid SSR issues with Quill
const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

declare global {
    interface Window {
        katex: any;
        hljs: any;
    }
}

export default function Editor({ categoryId, userId }: { categoryId: string, userId: string }) {
    const searchParams = useSearchParams();
    const urlDate = searchParams.get('date');
    const selectedDate = urlDate || new Date().toISOString().split('T')[0];
    const urlEntryId = searchParams.get('entry') ? parseInt(searchParams.get('entry')!, 10) : null;

    const [value, setValue] = useState('');
    const [entryId, setEntryId] = useState<number | null>(null);
    const [entryTitle, setEntryTitle] = useState<string>('');
    const [saving, setSaving] = useState(false);

    // Refs for Data Safety (The "Truth" outside React render cycle)
    const contentRef = useRef('');
    const entryIdRef = useRef<number | null>(null);
    const isDirtyRef = useRef(false);

    // Setup KaTeX and Highlight.js for Quill
    useEffect(() => {
        window.katex = katex;
        window.hljs = hljs;
    }, []);

    // Sync refs with state
    useEffect(() => { entryIdRef.current = entryId; }, [entryId]);

    // Core Save Function - The "Cannot Fail" Logic with Retry
    const performSave = async (id: number, content: string, isAutoSave = false, retryCount = 0): Promise<boolean> => {
        if (isAutoSave) {
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
                keepalive: true,
                body: JSON.stringify({
                    userId,
                    content: { ops: [{ insert: content }] },
                    html: content,
                    title: derivedTitle,
                    preview: derivedPreview
                })
            });

            if (res.ok) {
                window.dispatchEvent(new CustomEvent('journal-entry-updated'));
                isDirtyRef.current = false;
                // Clear backup on successful save
                localStorage.removeItem('editor_backup');
                return true;
            }
            throw new Error(`HTTP ${res.status}`);

        } catch (err) {
            // Retry with exponential backoff (max 3 retries)
            if (retryCount < 3) {
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, retryCount)));
                return performSave(id, content, isAutoSave, retryCount + 1);
            }
            return false;
        } finally {
            if (isAutoSave) setSaving(false);
        }
    };

    // Text Change Handler
    const handleChange = (content: string) => {
        setValue(content);
        if (contentRef.current !== content) {
            contentRef.current = content;
            if (!isDirtyRef.current) {
                isDirtyRef.current = true;
            }
        }
    };

    // Auto-Save Timer (Debounce)
    useEffect(() => {
        const timer = setTimeout(() => {
            if (isDirtyRef.current && entryIdRef.current) {
                performSave(entryIdRef.current, contentRef.current, true);
            }
        }, 1000);
        return () => clearTimeout(timer);
    }, [value]);

    // LocalStorage Backup (Crash Recovery)
    useEffect(() => {
        const backupTimer = setInterval(() => {
            if (entryIdRef.current && contentRef.current && isDirtyRef.current) {
                localStorage.setItem('editor_backup', JSON.stringify({
                    entryId: entryIdRef.current,
                    content: contentRef.current,
                    timestamp: Date.now()
                }));
            }
        }, 5000);
        return () => clearInterval(backupTimer);
    }, []);

    // beforeunload Warning (Accidental Close Protection)
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirtyRef.current) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    // Navigation / Unmount Safety Net
    useEffect(() => {
        return () => {
            const idToSave = entryIdRef.current;
            const contentToSave = contentRef.current;
            const wasDirty = isDirtyRef.current;

            // Only save on unmount if we have valid content and it was dirty
            // This prevents wiping data on rapid reloads where content might be briefly empty
            if (wasDirty && idToSave && contentToSave && contentToSave.trim() !== '' && contentToSave !== '<p><br></p>') {
                // Use beacon for reliable unmount fetch if supported, otherwise standard fetch
                // For now, standard fetch with keepalive which we already use in performSave
                performSave(idToSave, contentToSave, false);
            }
        };
    }, [urlEntryId, selectedDate]);

    // Initial Load Logic
    useEffect(() => {
        const abortController = new AbortController();
        let isMounted = true;

        const fetchEntry = async () => {
            let loadedId: number | null = null;
            let loadedContent = '';

            try {
                if (urlEntryId) {
                    const res = await fetch(`/api/entry/${urlEntryId}`, { signal: abortController.signal });
                    if (res.ok) {
                        const data = await res.json();
                        loadedId = data.EntryID;
                        loadedContent = data.HtmlContent || '';
                        if (isMounted) setEntryTitle(data.Title || 'Untitled Page');
                    }
                } else {
                    const res = await fetch('/api/entry/by-date', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ date: selectedDate, categoryId, userId }),
                        signal: abortController.signal
                    });
                    if (res.ok) {
                        const data = await res.json();
                        loadedId = data.id;
                        loadedContent = data.html || '';
                        if (isMounted) setEntryTitle(''); // Clear title for journal entries
                    }
                }
            } catch (err) {
                // Silent fail on load - entry will be empty (or aborted)
                return;
            }

            if (!isMounted) return;

            // Check for backup recovery
            const backup = localStorage.getItem('editor_backup');
            if (backup && loadedId) {
                try {
                    const backupData = JSON.parse(backup);
                    // Only offer recovery if backup is for same entry and is recent (< 1 hour)
                    if (backupData.entryId === loadedId &&
                        Date.now() - backupData.timestamp < 3600000 &&
                        backupData.content !== loadedContent) {
                        // Silently use backup if it's newer (automatic recovery)
                        loadedContent = backupData.content;
                        isDirtyRef.current = true; // Mark as dirty to trigger save
                    }
                } catch (e) {
                    localStorage.removeItem('editor_backup');
                }
            }

            setValue(loadedContent);
            setEntryId(loadedId);
            contentRef.current = loadedContent;
            if (!isDirtyRef.current) isDirtyRef.current = false;
        };

        fetchEntry();

        return () => {
            isMounted = false;
            abortController.abort();
        };
    }, [categoryId, userId, selectedDate, urlEntryId]);



    // ... other imports

    // Toolbar Modules - Memoized to prevent re-renders
    const modules = useMemo(() => ({
        syntax: {
            highlight: (text: string) => hljs.highlightAuto(text).value,
        },
        toolbar: {
            container: [
                [{ 'font': [] }, { 'size': [] }],
                [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'color': [] }, { 'background': [] }],
                [{ 'script': 'sub' }, { 'script': 'super' }],
                [{ 'header': 1 }, { 'header': 2 }, 'blockquote', 'code-block'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
                [{ 'direction': 'rtl' }, { 'align': [] }],
                ['link', 'image', 'video', 'formula'],
                ['clean']
            ],
        },
    }), []);

    return (
        <div className="flex flex-col h-full bg-bg-app transition-colors duration-200">
            {/* Breadcrumb Header - replacing the old fixed title bar */}
            {urlEntryId && (
                <div className="h-10 border-b border-border-primary flex items-center justify-between px-4 bg-bg-sidebar transition-colors duration-200">
                    <div className="flex-1 overflow-hidden">
                        <Breadcrumbs entryId={urlEntryId} categoryId={categoryId} />
                    </div>
                    <div className="flex items-center ml-4 flex-shrink-0">
                        <span className={`text-[10px] uppercase tracking-wider font-semibold flex items-center transition-colors ${saving ? 'text-yellow-500' : 'text-green-500'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${saving ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
                            {saving ? 'Saving' : 'Saved'}
                        </span>
                    </div>
                </div>
            )}

            {/* Floating save indicator for journal mode */}
            {!urlEntryId && (
                <div className="h-8 border-b border-border-primary flex items-center justify-end px-4 bg-bg-app absolute top-0 right-0 z-50 pointer-events-none">
                    <span className={`text-xs flex items-center transition-colors ${saving ? 'text-yellow-500' : 'text-green-500'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saving ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
                        {saving ? 'Saving...' : 'Saved'}
                    </span>
                </div>
            )}

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

                /* FIX: specific override for the Code Block Language dropdown (select element) */
                select.ql-ui {
                    background-color: transparent !important;
                    color: #f3f4f6 !important; /* Always light text because code block is always dark (atom-one-dark) */
                    border: none !important;
                    padding: 0 4px !important;
                    cursor: pointer;
                }
                select.ql-ui:hover {
                    text-decoration: underline;
                }
                /* Native options often cannot be fully transparent, but we try to match theme */
                select.ql-ui option {
                    background-color: var(--bg-card) !important;
                    color: var(--text-primary) !important;
                }
                
                /* Ensure the container or tooltip holding it handles dark mode correctly if needed */
                .ql-tooltip {
                    background-color: transparent !important;
                    border: none !important;
                    box-shadow: none !important;
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
