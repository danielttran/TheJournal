"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useMemo } from 'react';
import hljs from 'highlight.js';
import 'react-quill-new/dist/quill.snow.css'; // Add css for snow theme

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useSearchParams } from 'next/navigation';

// ... other imports
import Breadcrumbs from './Breadcrumbs';

// Dynamic import to avoid SSR issues with Quill
// Dynamic import to avoid SSR issues with Quill
const ReactQuill = dynamic(async () => {
    const { default: RQ, Quill } = await import('react-quill-new');

    const BlockEmbed = Quill.import('blots/block/embed');
    const Link = Quill.import('formats/link');

    class CustomVideo extends BlockEmbed {
        static create(value: string) {
            const node = super.create();
            const iframe = node as HTMLIFrameElement;
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('allowfullscreen', 'true');
            iframe.setAttribute('src', this.sanitize(value));
            return iframe;
        }

        static value(node: any) {
            return node.getAttribute('src');
        }

        static sanitize(url: string) {
            return Link.sanitize(url);
        }
    }
    CustomVideo.blotName = 'video';
    CustomVideo.tagName = 'iframe';
    CustomVideo.className = 'ql-video';

    Quill.register(CustomVideo as any, true);

    return RQ;
}, { ssr: false });

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

    // List of supported formats - explicitly including video
    const formats = [
        'header', 'font', 'size',
        'bold', 'italic', 'underline', 'strike', 'blockquote',
        'list', 'indent',
        'link', 'image', 'video', 'formula',
        'color', 'background',
        'script', 'direction', 'align', 'code-block'
    ];

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
                    formats={formats}
                    className="flex-1 flex flex-col bg-transparent border-none"
                    placeholder="Start writing..."
                />
            </div>
        </div>
    );
}
