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
    const { default: hljs } = await import('highlight.js');

    if (typeof window !== 'undefined') {
        window.hljs = hljs;
    }

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

// ---------------------------------------------------------------------------
// Module-level entry cache — survives React re-renders and note navigation.
// Fetches always run to completion even after the component unmounts, so the
// data is ready when the user switches back.
// ---------------------------------------------------------------------------
type CacheEntry = {
    content: string;
    title: string;
    entryId: number | null;
};

const entryCache = new Map<string, CacheEntry>();
// Pending promises keyed by cache key — prevents duplicate in-flight requests.
const pendingFetches = new Map<string, Promise<CacheEntry | null>>();

function getCacheKey(
    urlEntryId: number | null,
    selectedDate: string,
    categoryId: string,
): string {
    return urlEntryId ? `entry:${urlEntryId}` : `date:${categoryId}:${selectedDate}`;
}

/** Fetch note data from the API (no AbortSignal — intentionally runs in background). */
async function fetchEntryData(
    urlEntryId: number | null,
    selectedDate: string,
    categoryId: string,
    userId: string,
): Promise<CacheEntry | null> {
    try {
        if (urlEntryId) {
            const res = await fetch(`/api/entry/${urlEntryId}`);
            if (res.ok) {
                const data = await res.json();
                return {
                    entryId: data.EntryID,
                    content: data.HtmlContent || '',
                    title: data.Title || 'Untitled Page',
                };
            }
        } else {
            const res = await fetch('/api/entry/by-date', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: selectedDate, categoryId, userId }),
            });
            if (res.ok) {
                const data = await res.json();
                return {
                    entryId: data.id,
                    content: data.html || '',
                    title: '',
                };
            }
        }
        return null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------

export default function Editor({ categoryId, userId }: { categoryId: string, userId: string }) {
    const searchParams = useSearchParams();
    const urlDate = searchParams.get('date');
    const selectedDate = urlDate || new Date().toISOString().split('T')[0];
    const urlEntryId = searchParams.get('entry') ? parseInt(searchParams.get('entry')!, 10) : null;

    const [value, setValue] = useState('');
    const [entryId, setEntryId] = useState<number | null>(null);
    const [entryTitle, setEntryTitle] = useState<string>('');
    const [saving, setSaving] = useState(false);
    const [isLoadingEntry, setIsLoadingEntry] = useState(false);

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
                // Keep cache in sync with saved content so navigating back shows latest
                const byIdKey = `entry:${id}`;
                const byDateKey = `date:${categoryId}:${selectedDate}`;
                for (const key of [byIdKey, byDateKey]) {
                    const cached = entryCache.get(key);
                    if (cached && cached.entryId === id) {
                        entryCache.set(key, { ...cached, content });
                    }
                }
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
            // Keep cache current with live edits — if the user switches away
            // and back, they'll see their in-progress work, not stale data.
            const cacheKey = getCacheKey(urlEntryId, selectedDate, categoryId);
            const cached = entryCache.get(cacheKey);
            if (cached) {
                entryCache.set(cacheKey, { ...cached, content });
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

    // ---------------------------------------------------------------------------
    // Initial Load Logic — background-cache aware
    //
    // Key behaviours:
    //  1. Cache hit  → render immediately, no network round-trip.
    //  2. In-flight  → reuse the existing Promise (no duplicate request).
    //  3. Miss       → start fetch WITHOUT an AbortSignal so it continues
    //                  running even if the user navigates away.  When it
    //                  resolves the result is stored in the cache and, if the
    //                  user has already switched notes, the state update is
    //                  skipped (isMounted guard).  Switching back later gets
    //                  an instant cache hit.
    // ---------------------------------------------------------------------------
    useEffect(() => {
        let isMounted = true;
        const cacheKey = getCacheKey(urlEntryId, selectedDate, categoryId);

        const loadEntry = async () => {
            // 1. Instant cache hit
            const cached = entryCache.get(cacheKey);
            if (cached) {
                if (isMounted) {
                    setValue(cached.content);
                    setEntryId(cached.entryId);
                    setEntryTitle(urlEntryId ? cached.title : '');
                    contentRef.current = cached.content;
                    isDirtyRef.current = false;
                }
                return;
            }

            // 2. Reuse an already in-flight request for the same key
            //    (handles: user navigates away then immediately back)
            let fetchPromise = pendingFetches.get(cacheKey);
            if (!fetchPromise) {
                // 3. Start a new background fetch — no AbortSignal
                fetchPromise = fetchEntryData(urlEntryId, selectedDate, categoryId, userId);
                pendingFetches.set(cacheKey, fetchPromise);
            }

            setIsLoadingEntry(true);
            const result = await fetchPromise;
            // Remove pending entry regardless of who resolves first
            pendingFetches.delete(cacheKey);

            if (!result) {
                if (isMounted) setIsLoadingEntry(false);
                return;
            }

            // Apply crash-recovery backup if it's for this entry and is recent
            let finalContent = result.content;
            const backup = localStorage.getItem('editor_backup');
            if (backup && result.entryId) {
                try {
                    const backupData = JSON.parse(backup);
                    if (
                        backupData.entryId === result.entryId &&
                        Date.now() - backupData.timestamp < 3600000 &&
                        backupData.content !== result.content
                    ) {
                        finalContent = backupData.content;
                    }
                } catch {
                    localStorage.removeItem('editor_backup');
                }
            }

            const finalEntry: CacheEntry = { ...result, content: finalContent };

            // Always cache — even if the user has already navigated away.
            // This is the key to background loading: the data will be here
            // when they switch back.
            entryCache.set(cacheKey, finalEntry);

            if (isMounted) {
                setValue(finalEntry.content);
                setEntryId(finalEntry.entryId);
                setEntryTitle(urlEntryId ? finalEntry.title : '');
                contentRef.current = finalEntry.content;
                // Mark dirty only if we applied a backup (needs to be persisted)
                isDirtyRef.current = finalContent !== result.content;
                setIsLoadingEntry(false);
            }
        };

        loadEntry();

        return () => {
            isMounted = false;
            // Intentionally NOT aborting — the HTTP request continues in
            // the background and populates the cache for instant recall.
        };
    }, [categoryId, userId, selectedDate, urlEntryId]);


    const quillRef = useRef<any>(null);

    // Toolbar Modules
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
            handlers: {
                image: () => {
                    const input = document.createElement('input');
                    input.setAttribute('type', 'file');
                    input.setAttribute('accept', 'image/*');
                    input.click();

                    input.onchange = async () => {
                        const file = input.files?.[0];
                        if (file) {
                            const formData = new FormData();
                            formData.append('file', file);

                            const res = await fetch('/api/upload', { method: 'POST', body: formData });
                            const data = await res.json();
                            if (data.url && quillRef.current) {
                                const quill = quillRef.current.getEditor();
                                const range = quill.getSelection(true);
                                quill.insertEmbed(range.index, 'image', data.url);
                            }
                        }
                    };
                }
            }
        },
    }), []); // Empty deps might be issue if we need access to something, but refs are stable.



    return (
        <div className="flex flex-col h-full bg-bg-app transition-colors duration-200">
            {/* Breadcrumb Header - replacing the old fixed title bar */}
            {urlEntryId && (
                <div className="h-10 border-b border-border-primary flex items-center justify-between px-4 bg-bg-sidebar transition-colors duration-200">
                    <div className="flex-1 overflow-hidden">
                        <Breadcrumbs entryId={urlEntryId} categoryId={categoryId} />
                    </div>
                    <div className="flex items-center ml-4 flex-shrink-0">
                        {isLoadingEntry ? (
                            <span className="text-[10px] uppercase tracking-wider font-semibold flex items-center text-text-muted">
                                <div className="w-1.5 h-1.5 rounded-full mr-1.5 bg-text-muted animate-pulse"></div>
                                Loading
                            </span>
                        ) : (
                            <span className={`text-[10px] uppercase tracking-wider font-semibold flex items-center transition-colors ${saving ? 'text-yellow-500' : 'text-green-500'}`}>
                                <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${saving ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
                                {saving ? 'Saving' : 'Saved'}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Floating save indicator for journal mode */}
            {!urlEntryId && (
                <div className="h-8 border-b border-border-primary flex items-center justify-end px-4 bg-bg-app absolute top-0 right-0 z-50 pointer-events-none">
                    {isLoadingEntry ? (
                        <span className="text-xs flex items-center text-text-muted">
                            <div className="w-1.5 h-1.5 rounded-full mr-1 bg-text-muted animate-pulse"></div>
                            Loading...
                        </span>
                    ) : (
                        <span className={`text-xs flex items-center transition-colors ${saving ? 'text-yellow-500' : 'text-green-500'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saving ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
                            {saving ? 'Saving...' : 'Saved'}
                        </span>
                    )}
                </div>
            )}

            <div className="flex-1 overflow-hidden relative flex flex-col">
                {isLoadingEntry && !entryId && (
                    <div className="absolute inset-0 flex items-start justify-center pt-16 pointer-events-none z-10">
                        <div className="flex flex-col items-center gap-3 text-text-muted">
                            <div className="w-5 h-5 border-2 border-text-muted border-t-transparent rounded-full animate-spin opacity-50"></div>
                            <span className="text-xs opacity-50">Loading note…</span>
                        </div>
                    </div>
                )}
                <ReactQuill
                    ref={quillRef}
                    key={entryId || 'loading'}
                    theme="snow"
                    value={value}
                    onChange={handleChange}
                    modules={modules}
                    className="flex-1 flex flex-col bg-transparent border-none"
                    placeholder="Start writing..."
                />
            </div>
        </div>
    );
}
