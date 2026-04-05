"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import hljs from 'highlight.js';
import 'quill/dist/quill.snow.css';

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useSearchParams } from 'next/navigation';

import { Maximize2, Minimize2, Columns, ChevronDown } from 'lucide-react';
import Breadcrumbs from './Breadcrumbs';
import TemplatePicker, { type Template } from './TemplatePicker';
import { useLoading } from '@/contexts/LoadingContext';

const ReactQuill = dynamic(async () => {
    const { default: RQ, Quill } = await import('react-quill-new');
    const { default: hljs } = await import('highlight.js');

    if (typeof window !== 'undefined') {
        window.hljs = hljs;
    }

    const BlockEmbed = Quill.import('blots/block/embed') as any;
    const Link = Quill.import('formats/link') as any;

    const Size = Quill.import('attributors/style/size') as any;
    Size.whitelist = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '22px', '24px', '26px', '28px', '36px', '48px', '72px'];
    Quill.register(Size as any, true);

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
    (CustomVideo as any).blotName = 'video';
    (CustomVideo as any).tagName = 'iframe';
    (CustomVideo as any).className = 'ql-video';

    Quill.register(CustomVideo as any, true);

    return RQ;
}, { ssr: false });

declare global {
    interface Window {
        katex?: any;
        hljs?: any;
    }
}

// ─── View Menu ───────────────────────────────────────────────────────────────
// Dropdown shown in both header bars; lists Templates, Focus Mode, and Split View
// with their keyboard shortcuts. Rendered as a local component so it can share
// the Lucide imports from this file without a separate module.
function ViewMenu({
    isSplitMode,
    isOpen,
    onToggle,
    onClose,
    onTemplates,
    onFocus,
    onSplit,
    onSearch,
}: {
    isSplitMode: boolean;
    isOpen: boolean;
    onToggle: () => void;
    onClose: () => void;
    onTemplates: () => void;
    onFocus: () => void;
    onSplit: () => void;
    onSearch?: () => void;
}) {
    return (
        <div className="relative">
            <button
                onClick={onToggle}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${isOpen ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}
                title="View options"
            >
                View
                <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="absolute right-0 top-full mt-1 z-[200] bg-bg-card border border-border-primary rounded-lg shadow-xl py-1 min-w-[230px]">
                    <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-text-muted font-semibold">View</div>
                    {onSearch && (
                        <button
                            className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm text-text-primary flex items-center justify-between"
                            onClick={onSearch}
                        >
                            <span className="flex items-center gap-2">
                                <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" strokeWidth={2}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35"/></svg>
                                Search…
                            </span>
                            <kbd className="text-[10px] text-text-muted bg-bg-active border border-border-primary rounded px-1.5 py-0.5">Ctrl+F</kbd>
                        </button>
                    )}
                    <div className="mx-3 my-1 border-t border-border-primary" />
                    <button
                        className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm text-text-primary flex items-center justify-between"
                        onClick={onTemplates}
                    >
                        <span className="flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Templates…
                        </span>
                        <kbd className="text-[10px] text-text-muted bg-bg-active border border-border-primary rounded px-1.5 py-0.5">Ctrl+Shift+T</kbd>
                    </button>
                    <button
                        className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm text-text-primary flex items-center justify-between"
                        onClick={onFocus}
                    >
                        <span className="flex items-center gap-2">
                            <Maximize2 className="w-3.5 h-3.5 text-text-muted" />
                            Focus Mode
                        </span>
                        <kbd className="text-[10px] text-text-muted bg-bg-active border border-border-primary rounded px-1.5 py-0.5">F11</kbd>
                    </button>
                    <button
                        className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm text-text-primary flex items-center justify-between"
                        onClick={onSplit}
                    >
                        <span className="flex items-center gap-2">
                            <Columns className="w-3.5 h-3.5 text-text-muted" />
                            {isSplitMode ? 'Close Split' : 'Split View'}
                        </span>
                        <kbd className="text-[10px] text-text-muted bg-bg-active border border-border-primary rounded px-1.5 py-0.5">Ctrl+\</kbd>
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Entry content cache ──────────────────────────────────────────────────────
// Module-level LRU cache for fetched note content so background fetches persist
// across entry switches without re-fetching from the server.
//
// Bounds: max 200 entries (hard cap) + 10-minute TTL.
// On every write we evict the oldest entry once the cap is reached, ensuring the
// cache memory footprint stays bounded even in long sessions browsing large notebooks.
const entryContentCache = new Map<string, { html: string; delta: any; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;        // 10 minutes
const CACHE_MAX_ENTRIES = 200;               // hard cap — prevents unbounded growth

function cacheEntry(key: string, html: string, delta: any) {
    // Delete-then-reinsert moves the key to the end of Map insertion order (newest)
    entryContentCache.delete(key);
    entryContentCache.set(key, { html, delta, timestamp: Date.now() });

    // Evict: remove entries that are expired OR push the oldest out when over cap
    const now = Date.now();
    for (const [k, v] of entryContentCache) {
        if (entryContentCache.size <= CACHE_MAX_ENTRIES && now - v.timestamp <= CACHE_TTL_MS) break;
        entryContentCache.delete(k);
    }
}

function getCachedEntry(key: string) {
    const cached = entryContentCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
        entryContentCache.delete(key);
        return null;
    }
    // Refresh timestamp + move to end (LRU touch)
    entryContentCache.delete(key);
    entryContentCache.set(key, { ...cached, timestamp: Date.now() });
    return cached;
}

export default function Editor({
    categoryId,
    userId,
    onEnterSplitMode: onToggleSplitMode,
    isSplitMode = false,
    onOpenSearch,
    onEntryChange,
}: {
    categoryId: string;
    userId: string;
    /** Toggle callback — called for both enter and exit. */
    onEnterSplitMode?: () => void;
    isSplitMode?: boolean;
    /** Open the global search panel. */
    onOpenSearch?: () => void;
    /** Notifies parent of the currently loaded entry ID (null while loading). */
    onEntryChange?: (id: number | null) => void;
}) {
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
    // Template picker state
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
    const [isNewEntry, setIsNewEntry] = useState(false); // true when today's journal entry was just created
    // Distraction-free / focus mode
    const [isDistractionFree, setIsDistractionFree] = useState(false);
    const [showDfToolbar, setShowDfToolbar] = useState(false);
    // View menu dropdown
    const [showViewMenu, setShowViewMenu] = useState(false);
    // Right-click context menu
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

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
    // Second Quill instance for split view (same entry, independent scroll position)
    const quillRef2 = useRef<any>(null);
    // Prevents infinite sync loop: top→bottom→top→…
    const isSyncingRef = useRef(false);
    // Stable ref so handleChange/handleChange2 can read isSplitMode without re-creating
    const isSplitModeRef = useRef(isSplitMode);
    useEffect(() => { isSplitModeRef.current = isSplitMode; }, [isSplitMode]);
    // Container ref + ratio state for the horizontal resize divider
    const splitContainerRef = useRef<HTMLDivElement>(null);
    const [splitRatio, setSplitRatio] = useState(50);
    // Track current cache key for dual-key cache invalidation on save
    const cacheKeyRef = useRef<string>('');
    // Track entry version for optimistic locking (prevents concurrent edit data loss)
    const versionRef = useRef<number | null>(null);

    // SAFETY GUARD
    const isFullyLoadedRef = useRef(false);
    // Abort controller for canceling chunked Quill rendering when switching notes
    const renderAbortRef = useRef<AbortController | null>(null);
    useEffect(() => {
        window.katex = katex;
        window.hljs = hljs;
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // F11 → toggle distraction-free
            if (e.key === 'F11') {
                e.preventDefault();
                setIsDistractionFree(v => {
                    if (v) setShowDfToolbar(false);
                    return !v;
                });
                return;
            }
            // Escape → exit distraction-free, close menus
            if (e.key === 'Escape') {
                if (isDistractionFree) { setIsDistractionFree(false); setShowDfToolbar(false); }
                setShowViewMenu(false);
                setContextMenu(null);
                return;
            }
            // Ctrl+Shift+T → Templates
            if (e.ctrlKey && e.shiftKey && e.key === 'T') {
                e.preventDefault();
                setShowTemplatePicker(true);
                return;
            }
            // Ctrl+\ → Split view
            if (e.ctrlKey && e.key === '\\') {
                e.preventDefault();
                onToggleSplitMode?.();
                return;
            }
            // Ctrl+F → Search
            if (e.ctrlKey && !e.shiftKey && e.key === 'f') {
                e.preventDefault();
                onOpenSearch?.();
                return;
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isDistractionFree, onToggleSplitMode, onOpenSearch]);

    // entryIdRef is kept in sync by setting it directly alongside every setEntryId() call.
    // Do NOT rely purely on a useEffect for this — there is a render-cycle gap where
    // the ref is stale (null) even though state has the new ID. Fast switching in that
    // gap causes flushPendingSave to see entryIdRef=null and silently skip the save.

    // Core Save Function. snapshot is populated on first call and reused across retries
    // to avoid re-reading refs that may point to a different note after a switch.
    const performSave = useCallback(async (
        id: number, isAutoSave = false, retryCount = 0,
        snapshot?: { delta: any; html: string; version: number | null }
    ): Promise<boolean> => {
        if (!isFullyLoadedRef.current) {
            console.warn("Save blocked: Editor not fully loaded");
            return false;
        }

        if (isAutoSave) {
            setSaving(true);
            setSaveError(false);
        }

        // Snapshot content ONCE before retries — refs may change if user switches notes
        if (!snapshot) {
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

            snapshot = { delta, html: html || '', version: versionRef.current };
        }

        const { delta, html, version } = snapshot;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html || '';
        const plainText = tempDiv.textContent || tempDiv.innerText || '';
        const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
        const derivedPreview = plainText.substring(0, 200);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

        try {
            const res = await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    content: delta,
                    html: html,
                    title: derivedTitle,
                    preview: derivedPreview,
                    expectedVersion: version ?? undefined
                })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.version) versionRef.current = data.version;
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
            if (res.status === 409) {
                // Version conflict — another tab/session modified this entry
                const conflict = await res.json();
                console.error("Save conflict:", conflict.message);
                setSaveError(true);
                // Invalidate cache so revisiting this entry fetches fresh server content
                entryContentCache.delete(`entry-${id}`);
                if (cacheKeyRef.current) entryContentCache.delete(cacheKeyRef.current);
                // Don't retry on conflict — user must reload
                return false;
            }
            throw new Error(`HTTP ${res.status}`);

        } catch (err) {
            console.error("Save failed", err);
            // Don't retry on abort/timeout — server may have already processed the request
            if ((err as Error).name === 'AbortError') {
                setSaveError(true);
                return false;
            }
            if (retryCount < 3) {
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, retryCount)));
                return performSave(id, isAutoSave, retryCount + 1, snapshot);
            }
            // All retries exhausted — ensure data is preserved in localStorage
            try {
                localStorage.setItem('editor_backup', JSON.stringify({
                    entryId: id,
                    content: snapshot.html,
                    delta: snapshot.delta,
                    timestamp: Date.now()
                }));
            } catch (e) { /* localStorage might be full, but we tried */ }
            isDirtyRef.current = true; // Keep dirty so next attempt can retry
            setSaveError(true);
            return false;
        } finally {
            clearTimeout(timeoutId);
            if (isAutoSave) setSaving(false);
        }
    }, [userId]);

    const handleChange = useCallback((_content: string, changeDelta: any, source: string, editor: any) => {
        // ALWAYS update refs on every change
        contentRef.current = editor.getHTML();
        deltaRef.current = editor.getContents();

        if (source === 'user') {
            // ALWAYS mark dirty on user input — even during loading.
            // This ensures flushPendingSave captures content typed before isFullyLoaded.
            if (!isDirtyRef.current) {
                isDirtyRef.current = true;
                setSaveError(false);
            }

            // Propagate the exact change to the bottom pane when split is active
            if (isSplitModeRef.current && quillRef2.current && !isSyncingRef.current) {
                try {
                    isSyncingRef.current = true;
                    quillRef2.current.getEditor().updateContents(changeDelta, 'api');
                } catch { } finally { isSyncingRef.current = false; }
            }

            // Only schedule auto-save once fully loaded to avoid premature saves
            if (isFullyLoadedRef.current) {
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = setTimeout(() => {
                    if (entryIdRef.current && isDirtyRef.current) {
                        performSave(entryIdRef.current, true);
                    }
                }, 1000);
            }
        }
    }, [performSave]);

    // Backup
    useEffect(() => {
        const backupTimer = setInterval(() => {
            if (entryIdRef.current && isDirtyRef.current && isFullyLoadedRef.current) {
                localStorage.setItem('editor_backup', JSON.stringify({
                    entryId: entryIdRef.current,
                    content: contentRef.current,
                    delta: deltaRef.current,
                    timestamp: Date.now()
                }));
            }
        }, 5000);
        return () => clearInterval(backupTimer);
    }, []);

    // Build the JSON payload for a save, given snapshotted data.
    // Extracted so both flushPendingSave and beforeunload/sendBeacon can use it.
    const buildSavePayload = (id: number, delta: any, html: string, version: number | null) => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html || '';
        const plainText = tempDiv.textContent || tempDiv.innerText || '';
        const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
        const derivedPreview = plainText.substring(0, 200);

        return {
            url: `/api/entry/${id}`,
            body: {
                content: delta && (delta.ops ? delta : { ops: [{ insert: html }] }),
                html: html,
                title: derivedTitle,
                preview: derivedPreview,
                expectedVersion: version ?? undefined
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
        // Flush if dirty AND we have an entry ID.
        // Do NOT require isFullyLoadedRef — content typed during loading is still in refs
        // and must be saved before switching to avoid data loss.
        if (isDirtyRef.current && entryIdRef.current) {
            const id = entryIdRef.current;
            const { delta, html } = snapshotEditorState();
            const currentCacheKey = cacheKeyRef.current;
            const version = versionRef.current; // Snapshot before reset

            // Write a safety backup BEFORE attempting the network save.
            localStorage.setItem('editor_backup', JSON.stringify({
                entryId: id,
                content: html,
                delta: delta,
                timestamp: Date.now()
            }));

            // *** KEY FIX: Update the cache IMMEDIATELY with the latest typed content. ***
            // Without this, switching back before the PUT completes shows stale content
            // from the cache (which only had whatever was last saved to the server).
            cacheEntry(`entry-${id}`, html, delta);
            if (currentCacheKey && currentCacheKey !== `entry-${id}`) {
                cacheEntry(currentCacheKey, html, delta);
            }

            // Mark clean immediately to prevent double saves
            isDirtyRef.current = false;

            console.log(`[Editor] FLUSHING entry ${id} (isDirty: ${isDirtyRef.current}) | CacheKey: ${currentCacheKey} | HTML: ${html.length} chars`);

            const { url, body } = buildSavePayload(id, delta, html, version);

            // Attempt save with retry on failure
            const attemptSave = (attempt: number) => {
                fetch(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }).then(res => {
                    if (res.ok) {
                        console.log(`[Editor] Flush SUCCEEDED for entry ${id}`);
                        window.dispatchEvent(new CustomEvent('journal-entry-updated'));
                        // Only remove backup if it still belongs to this entry
                        try {
                            const backup = JSON.parse(localStorage.getItem('editor_backup') || '{}');
                            if (backup.entryId === id) localStorage.removeItem('editor_backup');
                        } catch (e) { localStorage.removeItem('editor_backup'); }
                        // Cache already updated above — no need to re-write on success
                    } else if (res.status === 409) {
                        console.error("Flush save conflict — another session modified this entry");
                    } else if (attempt < 2) {
                        setTimeout(() => attemptSave(attempt + 1), 500);
                    } else {
                        console.error("Flush save failed after retries, backup preserved in localStorage");
                        isDirtyRef.current = true;
                    }
                }).catch(err => {
                    if (attempt < 2) {
                        setTimeout(() => attemptSave(attempt + 1), 500);
                    } else {
                        console.error("Flush save failed:", err, "— backup preserved in localStorage");
                        isDirtyRef.current = true;
                    }
                });
            };

            attemptSave(0);
        }
    }, [userId]);

    // ── Split view helpers ────────────────────────────────────────────────────

    // Horizontal resize divider — drag to change top/bottom height ratio.
    const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const onMouseMove = (ev: MouseEvent) => {
            if (!splitContainerRef.current) return;
            const rect = splitContainerRef.current.getBoundingClientRect();
            const ratio = ((ev.clientY - rect.top) / rect.height) * 100;
            setSplitRatio(Math.max(20, Math.min(80, ratio)));
        };
        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.removeProperty('cursor');
            document.body.style.removeProperty('user-select');
        };
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, []);

    // When split mode turns on, seed the bottom pane with the current document.
    useEffect(() => {
        if (!isSplitMode) return;
        const seed = () => {
            if (!quillRef2.current) { setTimeout(seed, 50); return; }
            try {
                const q2 = quillRef2.current.getEditor();
                const d = deltaRef.current;
                if (d?.ops) { q2.setContents(d, 'api'); }
                else if (contentRef.current) { q2.clipboard.dangerouslyPasteHTML(contentRef.current, 'api'); }
            } catch { }
        };
        seed();
    }, [isSplitMode]);

    // Bottom-pane change handler — mirrors the primary handler but syncs UP to top pane.
    const handleChange2 = useCallback((
        _content: string, changeDelta: any, source: string, editor: any
    ) => {
        if (isSyncingRef.current) return;
        contentRef.current = editor.getHTML();
        deltaRef.current = editor.getContents();

        if (source === 'user') {
            if (!isDirtyRef.current) {
                isDirtyRef.current = true;
                setSaveError(false);
            }
            // Propagate the exact change to the top pane
            if (quillRef.current) {
                try {
                    isSyncingRef.current = true;
                    quillRef.current.getEditor().updateContents(changeDelta, 'api');
                } catch { } finally { isSyncingRef.current = false; }
            }
            if (isFullyLoadedRef.current) {
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = setTimeout(() => {
                    if (entryIdRef.current && isDirtyRef.current) performSave(entryIdRef.current, true);
                }, 1000);
            }
        }
    }, [performSave]);

    // ─────────────────────────────────────────────────────────────────────────

    // beforeunload: Use sendBeacon for reliability (fetch gets killed on tab close)
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!isDirtyRef.current || !entryIdRef.current || !isFullyLoadedRef.current) return;

            const id = entryIdRef.current;
            const { delta, html } = snapshotEditorState();
            const { url, body } = buildSavePayload(id, delta, html, versionRef.current);

            // Always write localStorage backup first — this is synchronous and guaranteed
            localStorage.setItem('editor_backup', JSON.stringify({
                entryId: id,
                content: html,
                delta: delta,
                timestamp: Date.now()
            }));

            // sendBeacon survives tab close (unlike fetch which gets aborted)
            // Use Blob with application/json Content-Type so the server can parse it
            const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
            const beaconSent = navigator.sendBeacon(url, blob);
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

    // Initial Load useEffect:
    // This effect manages the transition between notes.
    useEffect(() => {
        let isMounted = true;

        // 1. CRITICAL: Save any dirty content from the PREVIOUS note BEFORE we change any refs.
        // This snapshots content from the old note's identity.
        flushPendingSave();

        // 2. NOW it is safe to reset state and refs for the new note
        isFullyLoadedRef.current = false;
        // isDirtyRef should NOT be reset here if it was set during the render gap;
        // but flushPendingSave already set it to false if it handled the old note.
        // We'll set it to false here to be sure the new note starts clean.
        isDirtyRef.current = false;
        contentRef.current = '';
        deltaRef.current = null;
        versionRef.current = null;
        setIsNewEntry(false);

        // Cancel any previous Quill rendering controller
        if (renderAbortRef.current) {
            renderAbortRef.current.abort();
        }
        const renderAbort = new AbortController();
        renderAbortRef.current = renderAbort;

        setLoadingProgress(0);

        // 3. Update the cache key and entry ID refs for the new note
        const cacheKey = urlEntryId ? `entry-${urlEntryId}` : `date-${categoryId}-${selectedDate}`;
        cacheKeyRef.current = cacheKey;
        if (urlEntryId) entryIdRef.current = urlEntryId;

        // Clear Quill editor immediately to prevent stale content flash from previous note
        if (quillRef.current) {
            try {
                const quill = quillRef.current.getEditor();
                quill.setText('');
            } catch (e) { /* Quill not ready yet */ }
        }

        const loadEntry = async () => {
            try {
                setSaveError(false);

                // Use the local cacheKey we just built to avoid any race with the ref
                const cached = getCachedEntry(cacheKey);
                if (cached) {
                    console.log("Cache hit for", cacheKey);
                    if (!isMounted || renderAbort.signal.aborted) return;

                    // We still need the entry ID — derive it from cache key or re-fetch metadata
                    // For cached entries, load content directly into Quill
                    if (urlEntryId) {
                        setEntryId(urlEntryId);
                        onEntryChange?.(urlEntryId);
                        entryIdRef.current = urlEntryId; // Set ref immediately — don't wait for useEffect
                        // Fetch current version for optimistic locking even on cache hit.
                        // Only set if versionRef is still null (avoids race with saves that already updated it).
                        fetch(`/api/entry/${urlEntryId}`).then(r => r.ok ? r.json() : null).then(d => {
                            if (d?.Version && versionRef.current === null) versionRef.current = d.Version;
                        }).catch(() => {});
                        loadContentSafely(urlEntryId, cached.html, cached.delta, renderAbort.signal);
                    } else {
                        // For date-based entries, we need the ID — do a quick fetch
                        const res = await fetch('/api/entry/by-date', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ date: selectedDate, categoryId }),
                        });
                        if (!isMounted || renderAbort.signal.aborted) return;
                        if (res.ok) {
                            const data = await res.json();
                            const loadedId = data.EntryID || data.id;
                            setEntryId(loadedId);
                            onEntryChange?.(loadedId);
                            entryIdRef.current = loadedId; // Set ref immediately
                            versionRef.current = data.Version ?? null;
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
                        body: JSON.stringify({ date: selectedDate, categoryId }),
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
                    onEntryChange?.(loadedId);
                    entryIdRef.current = loadedId; // Set ref immediately — don't wait for useEffect
                    versionRef.current = data.Version ?? null;
                    if (data.isNew) setIsNewEntry(true);
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
            // CRITICAL: Flush any pending changes BEFORE clearing the timeout.
            // This is what ensures data is saved when switching notes quickly.
            flushPendingSave();

            // Only abort rendering, NOT the fetch — fetch continues to populate cache
            renderAbort.abort();
            // Clear any pending auto-save timeout to prevent redundant saves after unmount
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
            }
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

    const applyTemplate = useCallback((template: Template) => {
        if (!quillRef.current) return;
        try {
            const quill = quillRef.current.getEditor();
            let delta: any = null;
            if (template.QuillDelta) {
                try { delta = JSON.parse(template.QuillDelta); } catch { /* fall through to html */ }
            }
            if (delta?.ops) {
                quill.setContents(delta, 'api');
            } else if (template.HtmlContent) {
                quill.clipboard.dangerouslyPasteHTML(template.HtmlContent, 'api');
            }
            contentRef.current = quill.root.innerHTML;
            deltaRef.current = quill.getContents();
            isDirtyRef.current = true;
            // Persist immediately so the template content isn't lost on a quick navigation
            if (entryIdRef.current) performSave(entryIdRef.current, true);
        } catch (e) {
            console.error('Failed to apply template', e);
        }
    }, [performSave]);

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

    // Bottom pane has no toolbar — just a plain editable area
    const modules2 = useMemo(() => ({ toolbar: false }), []);

    const fontSizeWhitelist = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '22px', '24px', '26px', '28px', '36px', '48px', '72px'];
    const fontSizeCss = fontSizeWhitelist.map(size => `
        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="${size}"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="${size}"]::before {
            content: '${size}';
        }
    `).join('');

    return (
        <div className={`flex flex-col bg-bg-app transition-all duration-300 ${
            isDistractionFree
                ? 'fixed inset-0 z-[100]'
                : 'h-full'
        }`}>
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

                /* Distraction-free mode overrides */
                .df-toolbar-hidden .ql-toolbar.ql-snow {
                    display: none !important;
                }
                .df-mode .ql-container.ql-snow {
                    overflow-y: auto !important;
                    height: auto !important;
                    flex: unset !important;
                }
                .df-mode .ql-editor {
                    max-width: 720px;
                    margin: 0 auto;
                    padding: 3rem 2.5rem !important;
                    min-height: 100vh;
                    height: auto !important;
                    overflow: visible !important;
                    line-height: 1.8 !important;
                }
            `}</style>

            {/* Breadcrumb Header — hidden in distraction-free mode */}
            {urlEntryId && !isDistractionFree && (
                <div className="h-10 border-b border-border-primary flex items-center justify-between px-4 bg-bg-sidebar transition-colors duration-200">
                    <div className="flex-1 overflow-hidden">
                        <Breadcrumbs entryId={urlEntryId} categoryId={categoryId} />
                    </div>
                    <div className="flex items-center ml-4 flex-shrink-0 gap-3">
                        <span className={`text-[10px] uppercase tracking-wider font-semibold flex items-center transition-colors ${saveError ? 'text-red-500' : saving ? 'text-yellow-500' : 'text-green-500'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${saveError ? 'bg-red-500' : saving ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
                            {saveError ? 'Error Saving' : saving ? 'Saving' : 'Saved'}
                        </span>
                        <ViewMenu
                            isSplitMode={isSplitMode}
                            isOpen={showViewMenu}
                            onToggle={() => setShowViewMenu(v => !v)}
                            onClose={() => setShowViewMenu(false)}
                            onTemplates={() => { setShowViewMenu(false); setShowTemplatePicker(true); }}
                            onFocus={() => { setShowViewMenu(false); setIsDistractionFree(true); }}
                            onSplit={() => { setShowViewMenu(false); onToggleSplitMode?.(); }}
                            onSearch={() => { setShowViewMenu(false); onOpenSearch?.(); }}
                        />
                    </div>
                </div>
            )}

            {!urlEntryId && !isDistractionFree && (
                <div className="h-10 border-b border-border-primary flex items-center justify-between px-4 bg-bg-sidebar transition-colors duration-200 flex-shrink-0">
                    <span className={`text-xs flex items-center transition-colors ${saveError ? 'text-red-500' : saving ? 'text-yellow-500' : 'text-green-500'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saveError ? 'bg-red-500' : saving ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
                        {saveError ? 'Error Saving' : saving ? 'Saving...' : 'Saved'}
                    </span>
                    <ViewMenu
                        isSplitMode={isSplitMode}
                        isOpen={showViewMenu}
                        onToggle={() => setShowViewMenu(v => !v)}
                        onClose={() => setShowViewMenu(false)}
                        onTemplates={() => { setShowViewMenu(false); setShowTemplatePicker(true); }}
                        onFocus={() => { setShowViewMenu(false); setIsDistractionFree(true); }}
                        onSplit={() => { setShowViewMenu(false); onToggleSplitMode?.(); }}
                        onSearch={() => { setShowViewMenu(false); onOpenSearch?.(); }}
                    />
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

            {/* New-entry template banner — shown when today's entry was just created */}
            {isNewEntry && !showTemplatePicker && (
                <div className="flex items-center justify-between px-4 py-2 bg-accent-primary/10 border-b border-accent-primary/20 flex-shrink-0">
                    <span className="text-sm text-text-secondary">Start from a template?</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowTemplatePicker(true)}
                            className="text-sm px-3 py-1 rounded bg-accent-primary text-white hover:bg-accent-primary/80 transition-colors"
                        >
                            Choose template
                        </button>
                        <button
                            onClick={() => setIsNewEntry(false)}
                            className="text-sm text-text-muted hover:text-text-primary transition-colors"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )}

            {/* Template picker modal */}
            {showTemplatePicker && (
                <TemplatePicker
                    onSelect={(template) => {
                        setShowTemplatePicker(false);
                        setIsNewEntry(false);
                        if (template) applyTemplate(template);
                    }}
                    onClose={() => {
                        setShowTemplatePicker(false);
                        setIsNewEntry(false);
                    }}
                    currentHtml={isFullyLoadedRef.current ? contentRef.current : undefined}
                    currentDelta={isFullyLoadedRef.current ? deltaRef.current : undefined}
                />
            )}

            {/* Floating controls — only visible in distraction-free mode */}
            {isDistractionFree && (
                <div className="fixed top-4 right-6 z-[110] flex items-center gap-2 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300">
                    {/* Save indicator */}
                    <span className={`text-[10px] uppercase tracking-wider font-semibold flex items-center ${saveError ? 'text-red-400' : saving ? 'text-yellow-400' : 'text-green-400'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saveError ? 'bg-red-400' : saving ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`} />
                        {saveError ? 'Error' : saving ? 'Saving' : 'Saved'}
                    </span>
                    {/* Toolbar toggle */}
                    <button
                        onClick={() => setShowDfToolbar(v => !v)}
                        className="px-2.5 py-1.5 rounded-lg bg-bg-card border border-border-primary text-text-muted hover:text-accent-primary shadow-md text-xs font-semibold transition-colors"
                        title={showDfToolbar ? 'Hide toolbar' : 'Show toolbar'}
                    >
                        Aa
                    </button>
                    {/* Exit focus mode */}
                    <button
                        onClick={() => { setIsDistractionFree(false); setShowDfToolbar(false); }}
                        className="p-1.5 rounded-lg bg-bg-card border border-border-primary text-text-muted hover:text-red-400 shadow-md transition-colors"
                        title="Exit focus mode (Esc or F11)"
                    >
                        <Minimize2 className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Right-click context menu */}
            {contextMenu && (
                <div
                    className="fixed z-[300] bg-bg-card border border-border-primary rounded-lg shadow-xl py-1 min-w-[220px]"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={() => setContextMenu(null)}
                >
                    {onOpenSearch && (
                        <>
                            <button
                                className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm text-text-primary flex items-center justify-between"
                                onClick={() => onOpenSearch()}
                            >
                                <span>Search…</span>
                                <kbd className="text-[10px] text-text-muted bg-bg-active border border-border-primary rounded px-1.5 py-0.5">Ctrl+F</kbd>
                            </button>
                            <div className="mx-3 my-1 border-t border-border-primary" />
                        </>
                    )}
                    <button
                        className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm text-text-primary flex items-center justify-between"
                        onClick={() => setShowTemplatePicker(true)}
                    >
                        <span>Templates…</span>
                        <kbd className="text-[10px] text-text-muted bg-bg-active border border-border-primary rounded px-1.5 py-0.5">Ctrl+Shift+T</kbd>
                    </button>
                    <button
                        className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm text-text-primary flex items-center justify-between"
                        onClick={() => setIsDistractionFree(true)}
                    >
                        <span>Focus Mode</span>
                        <kbd className="text-[10px] text-text-muted bg-bg-active border border-border-primary rounded px-1.5 py-0.5">F11</kbd>
                    </button>
                    {onToggleSplitMode && (
                        <button
                            className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm text-text-primary flex items-center justify-between"
                            onClick={() => onToggleSplitMode()}
                        >
                            <span>Split View</span>
                            <kbd className="text-[10px] text-text-muted bg-bg-active border border-border-primary rounded px-1.5 py-0.5">Ctrl+\</kbd>
                        </button>
                    )}
                </div>
            )}
            {/* Dismiss context menu + view menu on outside click.
                Must be BELOW both menus in z-order so clicks on menu items
                reach the menu before the backdrop: context-menu z-[300],
                ViewMenu dropdown z-[200], this backdrop z-[150]. */}
            {(contextMenu || showViewMenu) && (
                <div
                    className="fixed inset-0 z-[150]"
                    onClick={() => { setContextMenu(null); setShowViewMenu(false); }}
                />
            )}

            <div
                ref={splitContainerRef}
                className={`flex-1 relative flex flex-col ${isDistractionFree ? 'df-mode overflow-y-auto' : 'overflow-hidden min-h-0'} ${isDistractionFree && !showDfToolbar ? 'df-toolbar-hidden' : ''}`}
                onContextMenu={e => {
                    e.preventDefault();
                    const menuW = 224;
                    const menuH = 130;
                    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
                    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
                    setContextMenu({ x, y });
                }}
            >
                {isSplitMode ? (
                    <>
                        {/* Top pane */}
                        <div
                            style={{ height: `${splitRatio}%` }}
                            className="flex flex-col min-h-0 overflow-hidden"
                        >
                            <ReactQuill
                                // @ts-expect-error — react-quill-new ref typings
                                ref={quillRef}
                                theme="snow"
                                defaultValue={''}
                                onChange={handleChange}
                                modules={modules}
                                className="flex-1 flex flex-col bg-transparent border-none min-h-0"
                                placeholder="Start writing..."
                            />
                        </div>

                        {/* Horizontal resize divider */}
                        <div
                            onMouseDown={handleDividerMouseDown}
                            className="h-1 bg-border-primary hover:bg-accent-primary cursor-row-resize flex-shrink-0 transition-colors relative"
                            title="Drag to resize"
                        >
                            <div className="absolute inset-x-0 -top-1 -bottom-1" />
                        </div>

                        {/* Bottom pane — same entry, independent scroll, no toolbar */}
                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                            <ReactQuill
                                // @ts-expect-error — react-quill-new ref typings
                                ref={quillRef2}
                                theme="snow"
                                defaultValue={''}
                                onChange={handleChange2}
                                modules={modules2}
                                className="flex-1 flex flex-col bg-transparent border-none min-h-0"
                                placeholder=""
                            />
                        </div>
                    </>
                ) : (
                    <ReactQuill
                        // @ts-expect-error — react-quill-new ref typings are incompatible with React 18 forwardRef
                        ref={quillRef}
                        theme="snow"
                        defaultValue={''}
                        onChange={handleChange}
                        modules={modules}
                        className="flex-1 flex flex-col bg-transparent border-none min-h-0"
                        placeholder="Start writing..."
                    />
                )}
            </div>
        </div>
    );
}
