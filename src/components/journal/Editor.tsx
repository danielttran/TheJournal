"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import hljs from 'highlight.js';
import 'react-quill-new/dist/quill.snow.css';

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useSearchParams } from 'next/navigation';

import Breadcrumbs from './Breadcrumbs';
import { useLoading } from '@/contexts/LoadingContext';

const ReactQuill = dynamic(async () => {
    const { default: RQ, Quill } = await import('react-quill-new');
    const { default: hljs } = await import('highlight.js');

    if (typeof window !== 'undefined') {
        window.hljs = hljs;
    }

    const BlockEmbed = Quill.import('blots/block/embed');
    const Link = Quill.import('formats/link');

    const Size = Quill.import('attributors/style/size');
    Size.whitelist = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '22px', '24px', '26px', '28px', '36px', '48px', '72px'];
    Quill.register(Size, true);

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
        electron?: any;
    }
}

// Module-level cache for fetched note content so background fetches persist across switches.
// No hard cap on number of entries — only TTL-based eviction + lazy cleanup.
// Disk is the only real limit; this cache holds references, not duplicates of disk data.
const entryContentCache = new Map<string, { html: string; delta: any; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // Sweep expired entries every 2 minutes

// Lazy cleanup: periodically evict expired entries to free memory
let lastCleanup = Date.now();

function cacheCleanup() {
    const now = Date.now();
    if (now - lastCleanup < CACHE_CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;
    for (const [key, entry] of entryContentCache) {
        if (now - entry.timestamp > CACHE_TTL_MS) {
            entryContentCache.delete(key);
        }
    }
}

function cacheEntry(key: string, html: string, delta: any) {
    entryContentCache.set(key, { html, delta, timestamp: Date.now() });
    cacheCleanup();
}

function getCachedEntry(key: string) {
    const cached = entryContentCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
        entryContentCache.delete(key);
        return null;
    }
    // Refresh timestamp on access (LRU behavior)
    cached.timestamp = Date.now();
    return cached;
}

export default function Editor({ categoryId, userId }: { categoryId: string, userId: string }) {
    const searchParams = useSearchParams();
    const urlDate = searchParams.get('date');
    const selectedDate = urlDate || new Date().toISOString().split('T')[0];
    const urlEntryId = searchParams.get('entry') ? parseInt(searchParams.get('entry')!, 10) : null;

    // Loading context for sharing state with Sidebar
    const { setLoading, clearLoading } = useLoading();

    const [entryId, setEntryId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState<number | null>(null);

    // Helper to update both local and context loading state
    const updateLoadingProgress = useCallback((entryId: number | null, progress: number | null) => {
        setLoadingProgress(progress);
        if (entryId !== null && progress !== null) {
            setLoading(entryId, progress);
        } else {
            clearLoading();
        }
    }, [setLoading, clearLoading]);

    // Refs for Data Safety
    const contentRef = useRef('');
    const deltaRef = useRef<any>(null);
    const entryIdRef = useRef<number | null>(null);
    const isDirtyRef = useRef(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const quillRef = useRef<any>(null);
    // Track current cache key for dual-key cache invalidation on save
    const cacheKeyRef = useRef<string>('');

    // SAFETY GUARD
    const isFullyLoadedRef = useRef(false);
    // Abort controller for canceling chunked Quill rendering when switching notes
    const renderAbortRef = useRef<AbortController | null>(null);
    useEffect(() => {
        window.katex = katex;
        window.hljs = hljs;
    }, []);

    useEffect(() => { entryIdRef.current = entryId; }, [entryId]);

    // Core Save Function
    const performSave = useCallback(async (id: number, isAutoSave = false, retryCount = 0): Promise<boolean> => {
        if (!isFullyLoadedRef.current) {
            console.warn("Save blocked: Editor not fully loaded");
            return false;
        }

        if (isAutoSave) {
            setSaving(true);
            setSaveError(false);
        }

        try {
            let delta = deltaRef.current;
            let html = contentRef.current;

            if (quillRef.current) {
                try {
                    const quill = quillRef.current.getEditor();
                    delta = quill.getContents();
                    html = quill.root.innerHTML;
                    deltaRef.current = delta;
                    contentRef.current = html;
                } catch (e) {
                    // Use refs if quill unavailable
                }
            }

            if (!delta && html) {
                delta = { ops: [{ insert: html }] };
            }

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html || '';
            const plainText = tempDiv.textContent || tempDiv.innerText || '';
            const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
            const derivedPreview = plainText.substring(0, 200);

            const res = await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    content: delta,
                    html: html,
                    title: derivedTitle,
                    preview: derivedPreview
                })
            });

            if (res.ok) {
                window.dispatchEvent(new CustomEvent('journal-entry-updated'));
                isDirtyRef.current = false;
                localStorage.removeItem('editor_backup');
                // Update cache with saved content so switching back loads latest.
                cacheEntry(`entry-${id}`, html, delta);
                // Also update the current cache key (handles date-based entries)
                if (cacheKeyRef.current && cacheKeyRef.current !== `entry-${id}`) {
                    cacheEntry(cacheKeyRef.current, html, delta);
                }
                return true;
            }
            throw new Error(`HTTP ${res.status}`);

        } catch (err) {
            console.error("Save failed", err);
            if (retryCount < 3) {
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, retryCount)));
                return performSave(id, isAutoSave, retryCount + 1);
            }
            // All retries exhausted — ensure data is preserved in localStorage
            try {
                localStorage.setItem('editor_backup', JSON.stringify({
                    entryId: id,
                    content: contentRef.current,
                    delta: deltaRef.current,
                    timestamp: Date.now()
                }));
            } catch (e) { /* localStorage might be full, but we tried */ }
            isDirtyRef.current = true; // Keep dirty so next attempt can retry
            setSaveError(true);
            return false;
        } finally {
            if (isAutoSave) setSaving(false);
        }
    }, [userId]);

    const handleChange = useCallback((_content: string, _delta: any, source: string, editor: any) => {
        // ALWAYS update refs
        contentRef.current = editor.getHTML();
        deltaRef.current = editor.getContents();

        if (source === 'user' && isFullyLoadedRef.current) {
            if (!isDirtyRef.current) {
                isDirtyRef.current = true;
                setSaveError(false);
            }

            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = setTimeout(() => {
                if (entryIdRef.current && isDirtyRef.current) {
                    performSave(entryIdRef.current, true);
                }
            }, 1000);
        }
    }, [performSave]);

    // Backup
    useEffect(() => {
        const backupTimer = setInterval(() => {
            if (entryIdRef.current && isDirtyRef.current && isFullyLoadedRef.current) {
                localStorage.setItem('editor_backup', JSON.stringify({
                    entryId: entryIdRef.current,
                    content: contentRef.current,
                    timestamp: Date.now()
                }));
            }
        }, 5000);
        return () => clearInterval(backupTimer);
    }, []);

    // Build the JSON payload for a save, given snapshotted data.
    // Extracted so both flushPendingSave and beforeunload/sendBeacon can use it.
    const buildSavePayload = (id: number, delta: any, html: string) => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html || '';
        const plainText = tempDiv.textContent || tempDiv.innerText || '';
        const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
        const derivedPreview = plainText.substring(0, 200);

        return {
            url: `/api/entry/${id}`,
            body: {
                userId,
                content: delta && (delta.ops ? delta : { ops: [{ insert: html }] }),
                html: html,
                title: derivedTitle,
                preview: derivedPreview
            }
        };
    };

    // Snapshot current editor state from Quill/refs. Must be called BEFORE refs are reset.
    const snapshotEditorState = () => {
        let delta = deltaRef.current;
        let html = contentRef.current;
        if (quillRef.current) {
            try {
                const quill = quillRef.current.getEditor();
                delta = quill.getContents();
                html = quill.root.innerHTML;
            } catch (e) { /* use refs */ }
        }
        if (!delta && html) {
            delta = { ops: [{ insert: html }] };
        }
        return { delta, html };
    };

    // Flush any pending save using captured ref data before switching notes.
    // This must run BEFORE the load effect resets refs, so we snapshot the data here.
    // On failure, the data is preserved in localStorage backup for recovery.
    const flushPendingSave = useCallback(() => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }
        if (isDirtyRef.current && entryIdRef.current && isFullyLoadedRef.current) {
            const id = entryIdRef.current;
            const { delta, html } = snapshotEditorState();
            const currentCacheKey = cacheKeyRef.current;

            // Write a safety backup BEFORE attempting the network save.
            // This ensures data survives even if the fetch fails AND the tab closes.
            localStorage.setItem('editor_backup', JSON.stringify({
                entryId: id,
                content: html,
                delta: delta,
                timestamp: Date.now()
            }));

            // Mark clean immediately to prevent double saves
            isDirtyRef.current = false;

            console.log("Flushing save for entry", id, "before switch");

            const { url, body } = buildSavePayload(id, delta, html);

            // Attempt save with retry on failure
            const attemptSave = (attempt: number) => {
                fetch(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }).then(res => {
                    if (res.ok) {
                        window.dispatchEvent(new CustomEvent('journal-entry-updated'));
                        localStorage.removeItem('editor_backup');
                        cacheEntry(`entry-${id}`, html, delta);
                        if (currentCacheKey && currentCacheKey !== `entry-${id}`) {
                            cacheEntry(currentCacheKey, html, delta);
                        }
                    } else if (attempt < 2) {
                        // Retry once on server error
                        setTimeout(() => attemptSave(attempt + 1), 500);
                    } else {
                        console.error("Flush save failed after retries, backup preserved in localStorage");
                    }
                }).catch(err => {
                    if (attempt < 2) {
                        setTimeout(() => attemptSave(attempt + 1), 500);
                    } else {
                        console.error("Flush save failed:", err, "— backup preserved in localStorage");
                    }
                });
            };

            attemptSave(0);
        }
    }, [userId]);

    // beforeunload: Use sendBeacon for reliability (fetch gets killed on tab close)
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!isDirtyRef.current || !entryIdRef.current || !isFullyLoadedRef.current) return;

            const id = entryIdRef.current;
            const { delta, html } = snapshotEditorState();
            const { url, body } = buildSavePayload(id, delta, html);

            // Always write localStorage backup first — this is synchronous and guaranteed
            localStorage.setItem('editor_backup', JSON.stringify({
                entryId: id,
                content: html,
                delta: delta,
                timestamp: Date.now()
            }));

            // sendBeacon survives tab close (unlike fetch which gets aborted)
            const beaconSent = navigator.sendBeacon(url, JSON.stringify(body));
            if (!beaconSent) {
                // Fallback: synchronous XHR (last resort, blocks UI but saves data)
                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', url, false); // false = synchronous
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.send(JSON.stringify(body));
                } catch (e) {
                    // localStorage backup is our safety net
                }
            }

            isDirtyRef.current = false;
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [userId]);

    // Helper to yield to main thread - uses 10ms delay to actually let browser process events
    const yieldToMain = (ms: number = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

    // NON-BLOCKING LOADING LOGIC - Aggressive chunking for huge content
    const loadContentSafely = useCallback(async (loadedEntryId: number, html: string | null, delta: any | null, signal?: AbortSignal) => {
        if (signal?.aborted) return;

        if (!quillRef.current) {
            setTimeout(() => loadContentSafely(loadedEntryId, html, delta, signal), 100);
            return;
        }

        const quill = quillRef.current.getEditor();

        // Check if delta is valid and usable
        const isValidDelta = delta && delta.ops && Array.isArray(delta.ops) && delta.ops.length > 0;

        // Calculate content size
        const contentSize = isValidDelta
            ? JSON.stringify(delta).length
            : (html?.length || 0);

        // SIMPLE PATH: Small content (< 100KB) - just load it directly
        const SMALL_THRESHOLD = 100000;
        if (contentSize < SMALL_THRESHOLD) {
            if (signal?.aborted) return;
            console.log("Loading directly (small content):", contentSize, "chars");
            updateLoadingProgress(loadedEntryId, 0);

            await yieldToMain(1);
            if (signal?.aborted) return;

            if (isValidDelta) {
                quill.setContents(delta, 'api');
            } else if (html) {
                quill.clipboard.dangerouslyPasteHTML(html, 'api');
            }

            contentRef.current = quill.root.innerHTML;
            deltaRef.current = quill.getContents();
            updateLoadingProgress(null, null);
            isFullyLoadedRef.current = true;
            return;
        }

        // LARGE CONTENT PATH - Very aggressive chunked loading
        console.log("Loading chunked (large content):", contentSize, "chars");
        updateLoadingProgress(loadedEntryId, 0);

        await yieldToMain(5);
        if (signal?.aborted) return;

        quill.enable(false);
        quill.setText('');

        if (isValidDelta) {
            // Process delta ops - split huge text inserts into VERY small chunks
            let ops = delta.ops;
            const processedOps: any[] = [];

            // Use very small chunks for huge content (500 chars each for better responsiveness)
            const CHUNK_SIZE = 500;

            for (const op of ops) {
                if (typeof op.insert === 'string' && op.insert.length > CHUNK_SIZE) {
                    // Split large text into small chunks
                    for (let i = 0; i < op.insert.length; i += CHUNK_SIZE) {
                        processedOps.push({
                            ...op,
                            insert: op.insert.substring(i, i + CHUNK_SIZE)
                        });
                    }
                } else {
                    processedOps.push(op);
                }
            }
            ops = processedOps;

            console.log("Split into", ops.length, "ops for chunked loading");

            // Use VERY small batches for responsiveness (5 ops = 2500 chars per batch)
            const BATCH_SIZE = 5;
            let index = 0;
            const totalOps = ops.length;

            // Async loop with proper yielding
            while (index < totalOps) {
                // CRITICAL: Check abort BEFORE each operation
                if (signal?.aborted) {
                    console.log("Loading aborted - user switched notes");
                    quill.enable(true);
                    updateLoadingProgress(null, null);
                    return;
                }

                const batch = ops.slice(index, index + BATCH_SIZE);
                quill.updateContents({ ops: batch }, 'api');
                index += BATCH_SIZE;

                // Update progress every 100 batches to reduce React re-renders
                if (index % (BATCH_SIZE * 20) === 0 || index >= totalOps) {
                    updateLoadingProgress(loadedEntryId, Math.min(99, Math.round((index / totalOps) * 100)));
                }

                // Yield with actual delay to allow click events to process
                await yieldToMain(1);
            }

            finishLoading();

        } else if (html) {
            // HTML chunking - very small chunks for responsiveness
            const CHUNK_SIZE = 10000;
            const totalChunks = Math.ceil(html.length / CHUNK_SIZE);

            for (let i = 0; i < html.length; i += CHUNK_SIZE) {
                // CRITICAL: Check abort BEFORE each operation
                if (signal?.aborted) {
                    console.log("Loading aborted - user switched notes");
                    quill.enable(true);
                    updateLoadingProgress(null, null);
                    return;
                }

                const chunk = html.substring(i, i + CHUNK_SIZE);
                quill.clipboard.dangerouslyPasteHTML(quill.getLength(), chunk, 'api');

                const chunkIndex = Math.floor(i / CHUNK_SIZE);
                if (chunkIndex % 10 === 0 || i + CHUNK_SIZE >= html.length) {
                    updateLoadingProgress(loadedEntryId, Math.min(99, Math.round(((chunkIndex + 1) / totalChunks) * 100)));
                }

                await yieldToMain(1);
            }

            finishLoading();
        } else {
            finishLoading();
        }

        function finishLoading() {
            if (signal?.aborted) return;
            quill.enable(true);
            contentRef.current = quill.root.innerHTML;
            deltaRef.current = quill.getContents();
            updateLoadingProgress(null, null);
            isFullyLoadedRef.current = true;
            console.log("Loading complete, content length:", contentRef.current.length);
        }

    }, [updateLoadingProgress]);

    // Initial Load
    useEffect(() => {
        // CRITICAL: Save any dirty content BEFORE resetting state for the new note.
        // This snapshots content from refs/Quill before they get wiped.
        flushPendingSave();

        // Cancel any previous Quill rendering (but NOT the fetch — let it finish and cache)
        if (renderAbortRef.current) {
            renderAbortRef.current.abort();
        }

        const renderAbort = new AbortController();
        renderAbortRef.current = renderAbort;
        let isMounted = true;

        // Reset state for the new note
        isFullyLoadedRef.current = false;
        isDirtyRef.current = false;
        contentRef.current = '';
        deltaRef.current = null;
        setLoadingProgress(0);

        // Clear Quill editor immediately to prevent stale content flash
        if (quillRef.current) {
            try {
                const quill = quillRef.current.getEditor();
                quill.setText('');
            } catch (e) { /* Quill not ready yet */ }
        }

        // Build a cache key for this note and store in ref for save-time cache updates
        const cacheKey = urlEntryId ? `entry-${urlEntryId}` : `date-${categoryId}-${selectedDate}`;
        cacheKeyRef.current = cacheKey;

        const loadEntry = async () => {
            try {
                setSaveError(false);

                // Check cache first for instant loading
                const cached = getCachedEntry(cacheKey);
                if (cached) {
                    console.log("Cache hit for", cacheKey);
                    if (!isMounted || renderAbort.signal.aborted) return;

                    // We still need the entry ID — derive it from cache key or re-fetch metadata
                    // For cached entries, load content directly into Quill
                    if (urlEntryId) {
                        setEntryId(urlEntryId);
                        loadContentSafely(urlEntryId, cached.html, cached.delta, renderAbort.signal);
                    } else {
                        // For date-based entries, we need the ID — do a quick fetch
                        const res = await fetch('/api/entry/by-date', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ date: selectedDate, categoryId, userId }),
                        });
                        if (!isMounted || renderAbort.signal.aborted) return;
                        if (res.ok) {
                            const data = await res.json();
                            const loadedId = data.EntryID || data.id;
                            setEntryId(loadedId);
                            loadContentSafely(loadedId, cached.html, cached.delta, renderAbort.signal);
                        }
                    }
                    return;
                }

                // No cache — fetch from API (without tying to render abort so it can complete in background)
                let data: any = null;

                if (urlEntryId) {
                    const res = await fetch(`/api/entry/${urlEntryId}`);
                    if (res.ok) data = await res.json();
                } else {
                    const res = await fetch('/api/entry/by-date', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ date: selectedDate, categoryId, userId }),
                    });
                    if (res.ok) data = await res.json();
                }

                if (data) {
                    const loadedId = data.EntryID || data.id;
                    let loadedHtml = data.HtmlContent || data.html || '';
                    let loadedDelta = null;

                    if (data.QuillDelta) {
                        try {
                            loadedDelta = typeof data.QuillDelta === 'string'
                                ? JSON.parse(data.QuillDelta)
                                : data.QuillDelta;
                        } catch (e) {
                            console.error("Failed to parse delta:", e);
                        }
                    }

                    // RECOVERY: Check if localStorage has a newer backup for this entry
                    // This catches data from failed saves (tab crash, network error, etc.)
                    try {
                        const backupStr = localStorage.getItem('editor_backup');
                        if (backupStr) {
                            const backup = JSON.parse(backupStr);
                            if (backup.entryId === loadedId && backup.timestamp) {
                                // Backup exists for this entry — check if it has more content
                                const backupLen = (backup.content || '').length;
                                const serverLen = loadedHtml.length;
                                // Use backup if it's newer than 10 seconds ago AND has content
                                // (A very recent backup likely means a save failed)
                                const isRecent = Date.now() - backup.timestamp < 5 * 60 * 1000; // 5 min
                                if (isRecent && backupLen > serverLen) {
                                    console.warn(`RECOVERY: Using localStorage backup for entry ${loadedId} (backup: ${backupLen} chars, server: ${serverLen} chars)`);
                                    loadedHtml = backup.content;
                                    loadedDelta = backup.delta || null;
                                    // Mark as dirty so it gets saved to server
                                    isDirtyRef.current = true;
                                }
                            }
                            // Clean up old backups for other entries
                            if (backup.entryId !== loadedId) {
                                localStorage.removeItem('editor_backup');
                            }
                        }
                    } catch (e) {
                        // Don't let backup recovery failure block normal loading
                        console.warn("Backup recovery check failed:", e);
                    }

                    // Always cache the fetched content (even if user switched away)
                    cacheEntry(cacheKey, loadedHtml, loadedDelta);

                    console.log("Loaded entry:", loadedId, "Delta ops:", loadedDelta?.ops?.length || 0, "HTML length:", loadedHtml.length);

                    // Only render into Quill if this effect is still current
                    if (!isMounted || renderAbort.signal.aborted) {
                        console.log("Fetch completed in background, cached for entry:", loadedId);
                        return;
                    }

                    setEntryId(loadedId);
                    loadContentSafely(loadedId, loadedHtml, loadedDelta, renderAbort.signal);

                } else {
                    if (isMounted && !renderAbort.signal.aborted) {
                        setSaveError(true);
                        updateLoadingProgress(null, null);
                        isFullyLoadedRef.current = true;
                    }
                }

            } catch (err) {
                if ((err as Error).name !== 'AbortError' && isMounted) {
                    console.error("Error fetching entry:", err);
                    setSaveError(true);
                    setLoadingProgress(null);
                }
            }
        };

        loadEntry();

        return () => {
            isMounted = false;
            // Only abort rendering, NOT the fetch — fetch continues to populate cache
            renderAbort.abort();
        };
    }, [categoryId, userId, selectedDate, urlEntryId, loadContentSafely, flushPendingSave]);


    // Font Size Settings
    const [defaultFontSize, setDefaultFontSize] = useState(14);
    useEffect(() => {
        const loadSettings = async () => {
            let saved: any = {};
            if (window.electron) {
                saved = await window.electron.getSettings();
            } else {
                try {
                    const savedStr = localStorage.getItem('app-settings');
                    saved = savedStr ? JSON.parse(savedStr) : {};
                } catch (e) { }
            }
            if (saved.defaultFontSize !== undefined) setDefaultFontSize(saved.defaultFontSize);
        };
        loadSettings();

        const handleSizeChange = (e: any) => {
            if (e.detail) setDefaultFontSize(e.detail);
        };
        window.addEventListener('font-size-changed', handleSizeChange);
        return () => window.removeEventListener('font-size-changed', handleSizeChange);
    }, []);

    const imageHandler = useCallback(() => {
        const input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('accept', 'image/*');
        input.click();

        input.onchange = async () => {
            if (input.files && input.files[0]) {
                const file = input.files[0];
                const formData = new FormData();
                formData.append('file', file);
                try {
                    setSaving(true);
                    const res = await fetch('/api/upload', {
                        method: 'POST',
                        body: formData
                    });
                    const data = await res.json();
                    if (data.url && quillRef.current) {
                        const quill = quillRef.current.getEditor();
                        const range = quill.getSelection(true);
                        quill.insertEmbed(range.index, 'image', data.url);
                    }
                } catch (e) {
                    console.error('Image upload failed', e);
                } finally {
                    setSaving(false);
                }
            }
        };
    }, []);

    const modules = useMemo(() => ({
        toolbar: {
            container: [
                [{ 'font': [] }, { 'size': [false, '8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '22px', '24px', '26px', '28px', '36px', '48px', '72px'] }],
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
                image: imageHandler
            }
        },
    }), [imageHandler]);

    const fontSizeWhitelist = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '22px', '24px', '26px', '28px', '36px', '48px', '72px'];
    const fontSizeCss = fontSizeWhitelist.map(size => `
        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="${size}"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="${size}"]::before {
            content: '${size}';
        }
    `).join('');

    return (
        <div className="flex flex-col h-full bg-bg-app transition-colors duration-200">
            <style>{`
                .ql-container { font-size: ${defaultFontSize}px !important; }
                .ql-container.ql-snow { 
                    font-size: ${defaultFontSize}px !important; 
                    border: none !important;
                    display: flex !important;
                    flex-direction: column;
                    flex: 1;
                    min-height: 0; 
                    overflow: hidden;
                    height: 100% !important;
                }
                .ql-editor { 
                    font-size: ${defaultFontSize}px !important;
                    flex: 1;
                    overflow-y: auto;
                    overflow-x: auto;
                    height: 100%;
                }
                ${fontSizeCss}
                .ql-snow .ql-picker.ql-size .ql-picker-label:not([data-value])::before,
                .ql-snow .ql-picker.ql-size .ql-picker-item:not([data-value])::before {
                    content: '${defaultFontSize}px';
                }
                .ql-snow .ql-picker.ql-size { width: 70px; }
                .ql-toolbar { flex-shrink: 0; }
            `}</style>

            {/* Breadcrumb Header */}
            {urlEntryId && (
                <div className="h-10 border-b border-border-primary flex items-center justify-between px-4 bg-bg-sidebar transition-colors duration-200">
                    <div className="flex-1 overflow-hidden">
                        <Breadcrumbs entryId={urlEntryId} categoryId={categoryId} />
                    </div>
                    <div className="flex items-center ml-4 flex-shrink-0 gap-4">
                        <span className={`text-[10px] uppercase tracking-wider font-semibold flex items-center transition-colors ${saveError ? 'text-red-500' : saving ? 'text-yellow-500' : 'text-green-500'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${saveError ? 'bg-red-500' : saving ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
                            {saveError ? 'Error Saving' : saving ? 'Saving' : 'Saved'}
                        </span>
                    </div>
                </div>
            )}

            {!urlEntryId && (
                <div className="h-8 border-b border-border-primary flex items-center justify-end px-4 bg-bg-app absolute top-0 right-0 z-50 pointer-events-none">
                    <span className={`text-xs flex items-center transition-colors ${saveError ? 'text-red-500' : saving ? 'text-yellow-500' : 'text-green-500'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saveError ? 'bg-red-500' : saving ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
                        {saveError ? 'Error' : saving ? 'Saving...' : 'Saved'}
                    </span>
                </div>
            )}

            {/* Prominent save error banner — must be impossible to miss */}
            {saveError && (
                <div className="bg-red-500/15 border border-red-500/50 text-red-400 px-4 py-2 flex items-center justify-between text-sm flex-shrink-0">
                    <span className="font-semibold">Save failed — your changes are backed up locally but not saved to the database. Check your connection and try editing again.</span>
                    <button
                        onClick={() => {
                            if (entryIdRef.current && isFullyLoadedRef.current) {
                                performSave(entryIdRef.current, true);
                            }
                        }}
                        className="ml-4 px-3 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600 whitespace-nowrap"
                    >
                        Retry Save
                    </button>
                </div>
            )}

            <div className="flex-1 overflow-hidden relative flex flex-col min-h-0">
                <ReactQuill
                    ref={quillRef}
                    theme="snow"
                    defaultValue={''}
                    onChange={handleChange}
                    modules={modules}
                    className="flex-1 flex flex-col bg-transparent border-none min-h-0"
                    placeholder="Start writing..."
                />
            </div>
        </div>
    );
}
