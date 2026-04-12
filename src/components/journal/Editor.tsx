"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Minimize2, Star, Hash, X } from 'lucide-react';
import Breadcrumbs from './Breadcrumbs';
import TemplatePicker, { type Template } from './TemplatePicker';
import WritingPromptsPicker from './WritingPromptsPicker';
import ImageCropModal from './ImageCropModal';
import { type WritingPrompt } from '@/lib/prompts';
import { useLoading } from '@/contexts/LoadingContext';
import TipTapToolbar from './TipTapToolbar';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import ResizableImage from './extensions/ResizableImage';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';

// ─── Pure helpers (module-level — no closures over component state) ───────────

/** Count words in an HTML string without touching the DOM. */
function countWords(html: string): number {
    const text = html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

// ─── Entry content cache ──────────────────────────────────────────────────────
const entryContentCache = new Map<string, { html: string; documentJson: any; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;        // 10 minutes
const CACHE_MAX_ENTRIES = 200;               // hard cap

function cacheEntry(key: string, html: string, documentJson: any) {
    entryContentCache.delete(key);
    entryContentCache.set(key, { html, documentJson, timestamp: Date.now() });

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
    entryContentCache.delete(key);
    entryContentCache.set(key, { ...cached, timestamp: Date.now() });
    return cached;
}

export default function Editor({
    categoryId,
    categoryName,
    categoryType,
    userId,
    onEnterSplitMode: onToggleSplitMode,
    isSplitMode = false,
    onOpenSearch,
    onEntryChange,
}: {
    categoryId: string;
    categoryName: string;
    categoryType: string;
    userId: string;
    /** Toggle split-view on/off. */
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

    const { setLoading, clearLoading } = useLoading();

    const [entryId, setEntryId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState<number | null>(null);
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
    const [isNewEntry, setIsNewEntry] = useState(false);
    const [isDistractionFree, setIsDistractionFree] = useState(false);
    const [showDfToolbar, setShowDfToolbar] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    const [isFloatingToolbar, setIsFloatingToolbar] = useState(false);
    const [wordCount, setWordCount] = useState(0);

    // Sprint 2: mood, favorites, tags, writing prompts
    const [mood, setMood] = useState<string | null>(null);
    const [isFavorited, setIsFavorited] = useState(false);
    const [tags, setTags] = useState<string[]>([]);
    const [showMoodPicker, setShowMoodPicker] = useState(false);
    const [showWritingPrompts, setShowWritingPrompts] = useState(false);
    const [tagInput, setTagInput] = useState('');
    const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
    const moodRef = useRef<string | null>(null);
    const isFavoritedRef = useRef(false);
    const tagsRef = useRef<string[]>([]);

    const updateLoadingProgress = useCallback((entryId: number | null, progress: number | null) => {
        setLoadingProgress(progress);
        if (entryId !== null && progress !== null) setLoading(entryId, progress);
        else clearLoading();
    }, [setLoading, clearLoading]);

    const contentRef = useRef('');
    const documentJsonRef = useRef<any>(null);
    const entryIdRef = useRef<number | null>(null);
    const isDirtyRef = useRef(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isSyncingRef = useRef(false);
    const cacheKeyRef = useRef<string>('');
    const versionRef = useRef<number | null>(null);
    const isFullyLoadedRef = useRef(false);
    const renderAbortRef = useRef<AbortController | null>(null);
    const splitContainerRef = useRef<HTMLDivElement>(null);
    const [splitRatio, setSplitRatio] = useState(50);

    // TipTap Extensions
    const extensions = useMemo(() => [
        StarterKit,
        ResizableImage,
        Link.configure({ openOnClick: false }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Highlight,
        Subscript,
        Superscript,
        TextStyle,
        Color,
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
        Markdown,
        Placeholder.configure({ placeholder: 'Start writing...' })
    ], []);

    // Refs to editors — needed so onUpdate callbacks can reference the OTHER editor
    // without stale closures (useEditor hooks fire before refs are set)
    const editor1Ref = useRef<any>(null);
    const editor2Ref = useRef<any>(null);

    const handleChange = useCallback((html: string, json: any, source: string) => {
        contentRef.current = html;
        documentJsonRef.current = json;
        setWordCount(countWords(html));

        if (source === 'user') {
            if (!isDirtyRef.current) {
                isDirtyRef.current = true;
                setSaveError(false);
            }
            if (isFullyLoadedRef.current) {
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = setTimeout(() => {
                    if (entryIdRef.current && isDirtyRef.current) performSave(entryIdRef.current, true);
                }, 1000);
            }
        }
    }, []);

    // Primary Editor
    const editor = useEditor({
        extensions,
        content: '',
        immediatelyRender: false,
        onUpdate: ({ editor: e, transaction }) => {
            if (!transaction.docChanged) return;
            handleChange(e.getHTML(), e.getJSON(), isSyncingRef.current ? 'api' : 'user');
            // Sync to pane 2 via ref (avoids stale closure)
            if (!isSyncingRef.current && editor2Ref.current) {
                isSyncingRef.current = true;
                try { editor2Ref.current.commands.setContent(e.getJSON(), { emitUpdate: false }); }
                finally { isSyncingRef.current = false; }
            }
        }
    });

    // Secondary Editor (split pane — only renders when isSplitMode is true)
    const editor2 = useEditor({
        extensions,
        content: '',
        immediatelyRender: false,
        onUpdate: ({ editor: e, transaction }) => {
            if (!transaction.docChanged) return;
            handleChange(e.getHTML(), e.getJSON(), isSyncingRef.current ? 'api' : 'user');
            // Sync back to pane 1 via ref
            if (!isSyncingRef.current && editor1Ref.current) {
                isSyncingRef.current = true;
                try { editor1Ref.current.commands.setContent(e.getJSON(), { emitUpdate: false }); }
                finally { isSyncingRef.current = false; }
            }
        }
    });

    // Keep refs in sync with the actual editor instances
    useEffect(() => { editor1Ref.current = editor; }, [editor]);
    useEffect(() => { editor2Ref.current = editor2; }, [editor2]);
// Font Size Settings
    const [defaultFontSize, setDefaultFontSize] = useState(14);
    useEffect(() => {
        const loadSettings = async () => {
            let saved: any = {};
            if (window.electron) saved = await window.electron.getSettings();
            else {
                try {
                    const savedStr = localStorage.getItem('app-settings');
                    saved = savedStr ? JSON.parse(savedStr) : {};
                } catch (e) { }
            }
            if (saved.defaultFontSize !== undefined) setDefaultFontSize(saved.defaultFontSize);
        };
        loadSettings();

        const handleSizeChange = (e: any) => { if (e.detail) setDefaultFontSize(e.detail); };
        window.addEventListener('font-size-changed', handleSizeChange);
        return () => window.removeEventListener('font-size-changed', handleSizeChange);
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'F11') {
                e.preventDefault();
                setIsDistractionFree(v => {
                    if (v) setShowDfToolbar(false);
                    return !v;
                });
                return;
            }
            if (e.key === 'Escape') {
                if (isDistractionFree) { setIsDistractionFree(false); setShowDfToolbar(false); }
                setContextMenu(null);
                return;
            }
            if (e.ctrlKey && e.shiftKey && e.key === 'T') {
                e.preventDefault();
                setShowTemplatePicker(true);
                return;
            }
            if (e.ctrlKey && e.shiftKey && e.key === 'P') {
                e.preventDefault();
                setShowWritingPrompts(true);
                return;
            }
            if (e.ctrlKey && e.key === '\\') {
                e.preventDefault();
                onToggleSplitMode?.();
                return;
            }
            if (e.ctrlKey && !e.shiftKey && e.key === 'f') {
                e.preventDefault();
                onOpenSearch?.();
                return;
            }
        };
        window.addEventListener('keydown', handler);

        const handleSearch = () => onOpenSearch?.();
        const handleTemplates = () => setShowTemplatePicker(true);
        const handleFocus = () => setIsDistractionFree(true);
        const handleSplit = () => onToggleSplitMode?.();
        const handleUndo = () => editor?.chain().focus().undo().run();
        const handleRedo = () => editor?.chain().focus().redo().run();
        const handleInlineCode = () => editor?.chain().focus().toggleCode().run();
        const handleChecklist = () => editor?.chain().focus().toggleTaskList().run();
        const handleHighlight = () => editor?.chain().focus().toggleHighlight().run();
        const handleHr = () => editor?.chain().focus().setHorizontalRule().run();
        const handlePrompts = () => setShowWritingPrompts(true);

        window.addEventListener('trigger-search', handleSearch);
        window.addEventListener('trigger-templates', handleTemplates);
        window.addEventListener('trigger-focus', handleFocus);
        window.addEventListener('trigger-split', handleSplit);
        window.addEventListener('trigger-undo', handleUndo);
        window.addEventListener('trigger-redo', handleRedo);
        window.addEventListener('trigger-inline-code', handleInlineCode);
        window.addEventListener('trigger-checklist', handleChecklist);
        window.addEventListener('trigger-highlight', handleHighlight);
        window.addEventListener('trigger-hr', handleHr);
        window.addEventListener('trigger-prompts', handlePrompts);

        return () => {
            window.removeEventListener('keydown', handler);
            window.removeEventListener('trigger-search', handleSearch);
            window.removeEventListener('trigger-templates', handleTemplates);
            window.removeEventListener('trigger-focus', handleFocus);
            window.removeEventListener('trigger-split', handleSplit);
            window.removeEventListener('trigger-undo', handleUndo);
            window.removeEventListener('trigger-redo', handleRedo);
            window.removeEventListener('trigger-inline-code', handleInlineCode);
            window.removeEventListener('trigger-checklist', handleChecklist);
            window.removeEventListener('trigger-highlight', handleHighlight);
            window.removeEventListener('trigger-hr', handleHr);
            window.removeEventListener('trigger-prompts', handlePrompts);
        };
    }, [editor, isDistractionFree, onOpenSearch, onToggleSplitMode]);


    const performSave = useCallback(async (
        id: number, isAutoSave = false, retryCount = 0,
        snapshot?: { html: string; documentJson: any; version: number | null }
    ): Promise<boolean> => {
        if (!isFullyLoadedRef.current) return false;

        if (isAutoSave) {
            setSaving(true);
            setSaveError(false);
        }

        if (!snapshot) {
            let html = contentRef.current;
            let documentJson = documentJsonRef.current;
            
            if (editor) {
                html = editor.getHTML();
                documentJson = editor.getJSON();
            }

            snapshot = { html: html || '', documentJson, version: versionRef.current };
        }

        const { html, documentJson, version } = snapshot;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html || '';
        const plainText = tempDiv.textContent || tempDiv.innerText || '';
        const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
        const derivedPreview = plainText.substring(0, 200);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            const res = await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    html: html,
                    documentJson: documentJson,
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
                cacheEntry(`entry-${id}`, html, documentJson);
                if (cacheKeyRef.current && cacheKeyRef.current !== `entry-${id}`) {
                    cacheEntry(cacheKeyRef.current, html, documentJson);
                }
                return true;
            }
            if (res.status === 409) {
                setSaveError(true);
                entryContentCache.delete(`entry-${id}`);
                if (cacheKeyRef.current) entryContentCache.delete(cacheKeyRef.current);
                return false;
            }
            throw new Error(`HTTP ${res.status}`);

        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                setSaveError(true);
                return false;
            }
            if (retryCount < 3) {
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, retryCount)));
                return performSave(id, isAutoSave, retryCount + 1, snapshot);
            }
            try {
                localStorage.setItem('editor_backup', JSON.stringify({
                    entryId: id,
                    content: snapshot.html,
                    documentJson: snapshot.documentJson,
                    timestamp: Date.now()
                }));
            } catch (e) { }
            isDirtyRef.current = true;
            setSaveError(true);
            return false;
        } finally {
            clearTimeout(timeoutId);
            if (isAutoSave) setSaving(false);
        }
    }, [editor]);

    useEffect(() => {
        const backupTimer = setInterval(() => {
            if (entryIdRef.current && isDirtyRef.current && isFullyLoadedRef.current) {
                localStorage.setItem('editor_backup', JSON.stringify({
                    entryId: entryIdRef.current,
                    content: contentRef.current,
                    documentJson: documentJsonRef.current,
                    timestamp: Date.now()
                }));
            }
        }, 5000);
        return () => clearInterval(backupTimer);
    }, []);

    const buildSavePayload = (id: number, html: string, documentJson: any, version: number | null) => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html || '';
        const plainText = tempDiv.textContent || tempDiv.innerText || '';
        const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
        const derivedPreview = plainText.substring(0, 200);

        return {
            url: `/api/entry/${id}`,
            body: {
                html: html,
                documentJson: documentJson,
                title: derivedTitle,
                preview: derivedPreview,
                expectedVersion: version ?? undefined
            }
        };
    };

    const flushPendingSave = useCallback(() => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }
        if (isDirtyRef.current && entryIdRef.current) {
            const id = entryIdRef.current;
            const html = contentRef.current;
            let documentJson = documentJsonRef.current;
            if (editor) {
                documentJson = editor.getJSON();
            }
            
            const currentCacheKey = cacheKeyRef.current;
            const version = versionRef.current;

            localStorage.setItem('editor_backup', JSON.stringify({
                entryId: id,
                content: html,
                documentJson: documentJson,
                timestamp: Date.now()
            }));

            cacheEntry(`entry-${id}`, html, documentJson);
            if (currentCacheKey && currentCacheKey !== `entry-${id}`) {
                cacheEntry(currentCacheKey, html, documentJson);
            }

            isDirtyRef.current = false;
            const { url, body } = buildSavePayload(id, html, documentJson, version);

            const attemptSave = (attempt: number) => {
                fetch(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }).then(res => {
                    if (res.ok) {
                        window.dispatchEvent(new CustomEvent('journal-entry-updated'));
                        try {
                            const backup = JSON.parse(localStorage.getItem('editor_backup') || '{}');
                            if (backup.entryId === id) localStorage.removeItem('editor_backup');
                        } catch (e) { localStorage.removeItem('editor_backup'); }
                    } else if (res.status === 409) {
                        console.error("Flush save conflict");
                    } else if (attempt < 2) {
                        setTimeout(() => attemptSave(attempt + 1), 500);
                    } else {
                        isDirtyRef.current = true;
                    }
                }).catch(() => {
                    if (attempt < 2) setTimeout(() => attemptSave(attempt + 1), 500);
                    else isDirtyRef.current = true;
                });
            };

            attemptSave(0);
        }
    }, [editor]);

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

    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!isDirtyRef.current || !entryIdRef.current || !isFullyLoadedRef.current) return;
            const id = entryIdRef.current;
            const html = contentRef.current;
            const documentJson = editor ? editor.getJSON() : documentJsonRef.current;
            const { url, body } = buildSavePayload(id, html, documentJson, versionRef.current);

            localStorage.setItem('editor_backup', JSON.stringify({
                entryId: id,
                content: html,
                documentJson: documentJson,
                timestamp: Date.now()
            }));

            const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
            if (!navigator.sendBeacon(url, blob)) {
                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('PUT', url, false);
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.send(JSON.stringify(body));
                } catch (e) { }
            }

            isDirtyRef.current = false;
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [editor]);

    // Initial Load useEffect
    useEffect(() => {
        let isMounted = true;
        flushPendingSave();

        isFullyLoadedRef.current = false;
        isDirtyRef.current = false;
        contentRef.current = '';
        documentJsonRef.current = null;
        versionRef.current = null;
        setIsNewEntry(false);
        setMood(null);
        setIsFavorited(false);
        setTags([]);
        setTagInput('');

        if (renderAbortRef.current) renderAbortRef.current.abort();
        const renderAbort = new AbortController();
        renderAbortRef.current = renderAbort;

        setLoadingProgress(0);

        const cacheKey = urlEntryId ? `entry-${urlEntryId}` : `date-${categoryId}-${selectedDate}`;
        cacheKeyRef.current = cacheKey;
        if (urlEntryId) entryIdRef.current = urlEntryId;

        // Clear both editors immediately
        if (editor) editor.commands.setContent('', { emitUpdate: false });
        if (editor2) editor2.commands.setContent('', { emitUpdate: false });

        const setContentSafely = (json: any, html: string) => {
            if (!isMounted || renderAbort.signal.aborted) return;

            const applyContent = (ed: any) => {
                if (!ed) return;
                if (json) {
                    try {
                        const parsed = typeof json === 'string' ? JSON.parse(json) : json;
                        ed.commands.setContent(parsed, { emitUpdate: false });
                    } catch {
                        ed.commands.setContent(html, { emitUpdate: false });
                    }
                } else {
                    ed.commands.setContent(html, { emitUpdate: false });
                }
            };

            applyContent(editor);
            applyContent(editor2);
            
            contentRef.current = html;
            documentJsonRef.current = editor ? editor.getJSON() : json;
            setWordCount(countWords(html));

            updateLoadingProgress(null, null);
            isFullyLoadedRef.current = true;
        };

        const loadEntry = async () => {
            try {
                setSaveError(false);

                const cached = getCachedEntry(cacheKey);
                if (cached) {
                    if (!isMounted || renderAbort.signal.aborted) return;

                    const applyMeta = (d: any) => {
                        if (!d) return;
                        const m = d.Mood ?? null;
                        const f = !!d.IsFavorited;
                        let t: string[] = [];
                        try { t = d.Tags ? JSON.parse(d.Tags) : []; } catch { t = []; }
                        setMood(m); setIsFavorited(f); setTags(t);
                        moodRef.current = m; isFavoritedRef.current = f; tagsRef.current = t;
                    };

                    if (urlEntryId) {
                        setEntryId(urlEntryId);
                        onEntryChange?.(urlEntryId);
                        entryIdRef.current = urlEntryId;
                        fetch(`/api/entry/${urlEntryId}`).then(r => r.ok ? r.json() : null).then(d => {
                            if (d?.Version && versionRef.current === null) versionRef.current = d.Version;
                            applyMeta(d);
                        }).catch(() => {});
                        setContentSafely(cached.documentJson, cached.html);
                    } else {
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
                            entryIdRef.current = loadedId;
                            versionRef.current = data.Version ?? null;
                            applyMeta(data);
                            setContentSafely(cached.documentJson, cached.html);
                        }
                    }
                    return;
                }

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
                    let loadedDocumentJson = data.DocumentJson || data.documentJson || null;

                    // Recovery payload
                    try {
                        const backupStr = localStorage.getItem('editor_backup');
                        if (backupStr) {
                            const backup = JSON.parse(backupStr);
                            if (backup.entryId === loadedId && backup.timestamp) {
                                const backupLen = (backup.content || '').length;
                                const serverLen = loadedHtml.length;
                                const isRecent = Date.now() - backup.timestamp < 5 * 60 * 1000;
                                if (isRecent && backupLen > serverLen) {
                                    loadedHtml = backup.content;
                                    loadedDocumentJson = backup.documentJson || loadedDocumentJson;
                                    isDirtyRef.current = true;
                                }
                            }
                            if (backup.entryId !== loadedId) localStorage.removeItem('editor_backup');
                        }
                    } catch (e) { }

                    documentJsonRef.current = loadedDocumentJson;
                    cacheEntry(cacheKey, loadedHtml, loadedDocumentJson);

                    if (!isMounted || renderAbort.signal.aborted) return;

                    setEntryId(loadedId);
                    onEntryChange?.(loadedId);
                    entryIdRef.current = loadedId;
                    versionRef.current = data.Version ?? null;
                    if (data.isNew) setIsNewEntry(true);

                    // Load Sprint 2 metadata
                    const loadedMood = data.Mood ?? null;
                    const loadedFavorited = !!data.IsFavorited;
                    let loadedTags: string[] = [];
                    try { loadedTags = data.Tags ? JSON.parse(data.Tags) : []; } catch { loadedTags = []; }
                    setMood(loadedMood);
                    setIsFavorited(loadedFavorited);
                    setTags(loadedTags);
                    moodRef.current = loadedMood;
                    isFavoritedRef.current = loadedFavorited;
                    tagsRef.current = loadedTags;

                    setContentSafely(loadedDocumentJson, loadedHtml);

                } else {
                    if (isMounted && !renderAbort.signal.aborted) {
                        setSaveError(true);
                        updateLoadingProgress(null, null);
                        isFullyLoadedRef.current = true;
                    }
                }

            } catch (err) {
                if ((err as Error).name !== 'AbortError' && isMounted) {
                    setSaveError(true);
                    setLoadingProgress(null);
                }
            }
        };

        // Delay execution slightly so the initial blank state renders and React settles
        const loadTimer = window.setTimeout(loadEntry, 10);

        return () => {
            isMounted = false;
            flushPendingSave();
            renderAbort.abort();
            window.clearTimeout(loadTimer);
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
            }
        };
    }, [categoryId, userId, selectedDate, urlEntryId, flushPendingSave, editor, editor2, onEntryChange, updateLoadingProgress]);

    const saveMetadata = useCallback(async (id: number, patch: { mood?: string | null; isFavorited?: boolean; tags?: string[] }) => {
        const body: Record<string, any> = {};
        if ('mood' in patch) body.mood = patch.mood ?? null;
        if ('isFavorited' in patch) body.isFavorited = patch.isFavorited;
        if ('tags' in patch) body.tags = JSON.stringify(patch.tags);
        try {
            const res = await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            window.dispatchEvent(new CustomEvent('journal-entry-updated'));
        } catch (err) {
            console.error('[Editor] saveMetadata failed:', err);
        }
    }, []);

    // ── Image helpers ────────────────────────────────────────────────────────────

    /** Upload a File and return the attachment URL, or null on failure. */
    const uploadImageFile = useCallback(async (file: File): Promise<string | null> => {
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
            return data.url as string;
        } catch (err) {
            console.error('[Editor] image upload failed:', err);
            return null;
        }
    }, []);

    /** Insert an uploaded image at the cursor. */
    const insertImage = useCallback((url: string) => {
        editor?.chain().focus().setImage({ src: url, width: '100%' } as any).run();
        isDirtyRef.current = true;
        if (entryIdRef.current) performSave(entryIdRef.current, true);
    }, [editor, performSave]);

    // Drag-and-drop images onto the editor area
    const handleEditorDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
        const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return; // not image files — let default DnD handle it
        e.preventDefault();
        for (const file of imageFiles) {
            const url = await uploadImageFile(file);
            if (url) insertImage(url);
        }
    }, [uploadImageFile, insertImage]);

    // Paste images from clipboard (e.g. screenshots)
    useEffect(() => {
        if (!editor) return;
        const handlePaste = async (e: ClipboardEvent) => {
            if (!editor.isFocused) return;
            const items = Array.from(e.clipboardData?.items ?? []);
            const imageItem = items.find(i => i.type.startsWith('image/'));
            if (!imageItem) return;
            e.preventDefault();
            const file = imageItem.getAsFile();
            if (!file) return;
            const url = await uploadImageFile(file);
            if (url) insertImage(url);
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [editor, uploadImageFile, insertImage]);

    // Crop trigger from toolbar
    useEffect(() => {
        const handler = () => {
            if (!editor?.isActive('image')) return;
            const src = editor.getAttributes('image').src as string | undefined;
            if (src) setCropImageSrc(src);
        };
        window.addEventListener('trigger-crop-image', handler);
        return () => window.removeEventListener('trigger-crop-image', handler);
    }, [editor]);

    const applyPrompt = useCallback((prompt: WritingPrompt) => {
        if (!editor) return;
        editor.chain().focus().insertContent({
            type: 'blockquote',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: prompt.text }] }],
        }).run();
        isDirtyRef.current = true;
        if (entryIdRef.current) performSave(entryIdRef.current, true);
    }, [editor, performSave]);

    const applyTemplate = useCallback((template: Template) => {
        if (!editor) return;
        try {
            let json = null;
            if (template.DocumentJson) {
                try { json = JSON.parse(template.DocumentJson); } catch {}
            }
            if (json) {
                editor.commands.setContent(json, { emitUpdate: false });
            } else if (template.HtmlContent) {
                editor.commands.setContent(template.HtmlContent, { emitUpdate: false });
            }
            
            contentRef.current = editor.getHTML();
            documentJsonRef.current = editor.getJSON();
            isDirtyRef.current = true;
            if (entryIdRef.current) performSave(entryIdRef.current, true);
        } catch (e) {
            console.error('Failed to apply template', e);
        }
    }, [performSave, editor]);

    return (
        <div className={`flex flex-col bg-bg-app transition-all duration-300 ${
            isDistractionFree
                ? 'fixed inset-0 z-[100]'
                : 'h-full'
        }`}>
            <style>{`
                .ProseMirror { font-size: ${defaultFontSize}px; outline: none; padding: 16px; margin: 0; min-height: 100%; flex: 1; }
                .ProseMirror p.is-editor-empty:first-of-type::before {
                    color: #a1a1aa;
                    content: attr(data-placeholder);
                    float: left;
                    height: 0;
                    pointer-events: none;
                }
                .ProseMirror img { max-width: 100%; height: auto; display: inline-block; }
                .ProseMirror blockquote { border-left: 3px solid var(--color-border-primary); padding-left: 1rem; color: var(--color-text-muted); }
                .ProseMirror pre { background: var(--color-bg-sidebar); border-radius: 0.5rem; padding: 0.75rem; font-family: monospace; }
                .ProseMirror code { background: var(--color-bg-sidebar); padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.9em; }
                .ProseMirror ul[data-type="taskList"] { list-style: none; padding: 0; }
                .ProseMirror ul[data-type="taskList"] li { display: flex; align-items: flex-start; }
                .ProseMirror ul[data-type="taskList"] li > label { margin-right: 0.5rem; user-select: none; }
                .ProseMirror ul[data-type="taskList"] li > div { flex: 1; }
                .tiptap-container { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
            `}</style>

            {entryId && !isDistractionFree && (
                <div className="h-10 border-b border-border-primary flex items-center justify-between px-4 bg-bg-sidebar">
                    <div className="flex-1 overflow-hidden">
                        <Breadcrumbs
                            entryId={entryId}
                            categoryId={categoryId}
                            categoryName={categoryName}
                            categoryType={categoryType}
                        />
                    </div>
                    <div className="flex items-center ml-4 flex-shrink-0 gap-2">
                        {wordCount > 0 && (
                            <span className="text-[10px] text-text-muted tabular-nums select-none">
                                {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
                            </span>
                        )}

                        {/* Mood picker */}
                        <div className="relative">
                            <button
                                onClick={() => setShowMoodPicker(v => !v)}
                                className="text-base leading-none p-1 rounded hover:bg-bg-hover transition-colors"
                                title="Set mood"
                            >
                                {mood || '🙂'}
                            </button>
                            {showMoodPicker && (
                                <>
                                <div className="fixed inset-0 z-[299]" onClick={() => setShowMoodPicker(false)} />
                                <div className="absolute right-0 top-full mt-1 z-[300] bg-bg-card border border-border-primary rounded-xl shadow-xl p-2 flex flex-wrap gap-1 w-48">
                                    {['😊','😄','🤩','😌','😔','😢','😤','😰','😴','🥺','🤔','💪','❤️','✨','🔥'].map(e => (
                                        <button
                                            key={e}
                                            className={`text-lg p-1 rounded hover:bg-bg-hover ${mood === e ? 'bg-bg-active ring-1 ring-accent-primary' : ''}`}
                                            onClick={() => {
                                                const newMood = mood === e ? null : e;
                                                setMood(newMood);
                                                moodRef.current = newMood;
                                                setShowMoodPicker(false);
                                                if (entryIdRef.current) saveMetadata(entryIdRef.current, { mood: newMood });
                                            }}
                                        >
                                            {e}
                                        </button>
                                    ))}
                                    {mood && (
                                        <button
                                            className="w-full text-xs text-text-muted hover:text-text-primary py-1 border-t border-border-primary mt-1"
                                            onClick={() => {
                                                setMood(null);
                                                moodRef.current = null;
                                                setShowMoodPicker(false);
                                                if (entryIdRef.current) saveMetadata(entryIdRef.current, { mood: null });
                                            }}
                                        >
                                            Clear mood
                                        </button>
                                    )}
                                </div>
                                </>
                            )}
                        </div>

                        {/* Favorite star */}
                        <button
                            onClick={() => {
                                const newVal = !isFavorited;
                                setIsFavorited(newVal);
                                isFavoritedRef.current = newVal;
                                if (entryIdRef.current) saveMetadata(entryIdRef.current, { isFavorited: newVal });
                            }}
                            className={`p-1 rounded hover:bg-bg-hover transition-colors ${isFavorited ? 'text-yellow-400' : 'text-text-muted'}`}
                            title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                        >
                            <Star className={`w-4 h-4 ${isFavorited ? 'fill-yellow-400' : ''}`} />
                        </button>

                        <span className={`text-[10px] uppercase tracking-wider font-semibold flex items-center ${saveError ? 'text-red-500' : saving ? 'text-yellow-500' : 'text-green-500'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${saveError ? 'bg-red-500' : saving ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
                            {saveError ? 'Error Saving' : saving ? 'Saving' : 'Saved'}
                        </span>
                    </div>
                </div>
            )}

            {saveError && (
                <div className="bg-red-500/15 border border-red-500/50 text-red-400 px-4 py-2 flex items-center justify-between text-sm flex-shrink-0">
                    <span className="font-semibold">Save failed — changes are backed up locally. check connection to save to database.</span>
                    <button
                        onClick={() => { if (entryIdRef.current && isFullyLoadedRef.current) performSave(entryIdRef.current, true); }}
                        className="ml-4 px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600 font-bold"
                    >
                        Retry Save
                    </button>
                </div>
            )}

            {isNewEntry && !showTemplatePicker && (
                <div className="flex items-center justify-between px-4 py-2 bg-accent-primary/10 border-b border-accent-primary/20 flex-shrink-0">
                    <span className="text-sm text-text-secondary">Start from a template?</span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setShowTemplatePicker(true)} className="text-sm px-3 py-1 rounded bg-accent-primary text-white hover:bg-accent-primary/80">Choose template</button>
                        <button onClick={() => setIsNewEntry(false)} className="text-sm text-text-muted hover:text-text-primary">Dismiss</button>
                    </div>
                </div>
            )}

            {showTemplatePicker && (
                <TemplatePicker
                    onSelect={(t) => {
                        setShowTemplatePicker(false);
                        setIsNewEntry(false);
                        if (t) applyTemplate(t);
                    }}
                    onClose={() => { setShowTemplatePicker(false); setIsNewEntry(false); }}
                    currentHtml={contentRef.current}
                    currentDocumentJson={documentJsonRef.current}
                />
            )}

            {contextMenu && (
                <div className="fixed z-[300] bg-bg-card border border-border-primary rounded-lg shadow-xl py-1 min-w-[220px]" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={() => setContextMenu(null)}>
                    {onOpenSearch && (
                        <button className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm flex items-center justify-between" onClick={() => onOpenSearch()}>
                            <span>Search…</span><kbd className="text-[10px] text-text-muted border border-border-primary rounded px-1.5 py-0.5">Ctrl+F</kbd>
                        </button>
                    )}
                    <div className="mx-3 my-1 border-t border-border-primary" />
                    <button className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm flex items-center justify-between" onClick={() => setIsFloatingToolbar(!isFloatingToolbar)}>
                        <span>{isFloatingToolbar ? 'Pin Toolbar' : 'Float Toolbar'}</span>
                    </button>
                    <button className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm flex items-center justify-between" onClick={() => setShowTemplatePicker(true)}>
                        <span>Templates…</span><kbd className="text-[10px] text-text-muted border border-border-primary rounded px-1.5 py-0.5">Ctrl+Shift+T</kbd>
                    </button>
                    <button className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm flex items-center justify-between" onClick={() => setIsDistractionFree(true)}>
                        <span>Focus Mode</span><kbd className="text-[10px] text-text-muted border border-border-primary rounded px-1.5 py-0.5">F11</kbd>
                    </button>
                    {onToggleSplitMode && (
                        <button className="w-full text-left px-4 py-2 hover:bg-bg-hover text-sm flex items-center justify-between" onClick={() => onToggleSplitMode()}>
                            <span>Split View</span><kbd className="text-[10px] text-text-muted border border-border-primary rounded px-1.5 py-0.5">Ctrl+\</kbd>
                        </button>
                    )}
                </div>
            )}
            {contextMenu && <div className="fixed inset-0 z-[150]" onClick={() => setContextMenu(null)} />}

            {isDistractionFree && (
                <div className="fixed top-4 right-6 z-[110] flex items-center gap-2 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => { setIsDistractionFree(false); setShowDfToolbar(false); }} className="p-1.5 rounded-lg bg-bg-card border border-border-primary hover:text-red-400">
                        <Minimize2 className="w-4 h-4" />
                    </button>
                </div>
            )}

            {!isFloatingToolbar && !isDistractionFree && <TipTapToolbar editor={editor} />}
            {isFloatingToolbar && editor && !isDistractionFree && (
                <div className="fixed top-20 right-8 z-[200] bg-bg-card rounded shadow-xl overflow-hidden border border-border-primary">
                    <TipTapToolbar editor={editor} />
                </div>
            )}

            {/* Tags bar */}
            {entryId && !isDistractionFree && (
                <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5 border-b border-border-primary bg-bg-sidebar flex-shrink-0 min-h-[36px]">
                    <Hash className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                    {tags.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-primary/15 text-accent-primary text-xs font-medium">
                            {tag}
                            <button
                                onClick={() => {
                                    const next = tags.filter(t => t !== tag);
                                    setTags(next);
                                    tagsRef.current = next;
                                    if (entryIdRef.current) saveMetadata(entryIdRef.current, { tags: next });
                                }}
                                className="hover:text-red-400 transition-colors"
                            >
                                <X className="w-2.5 h-2.5" />
                            </button>
                        </span>
                    ))}
                    <input
                        type="text"
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => {
                            if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                                e.preventDefault();
                                const newTag = tagInput.trim().replace(/,+$/, '').toLowerCase();
                                if (newTag && !tags.includes(newTag) && tags.length < 10) {
                                    const next = [...tags, newTag];
                                    setTags(next);
                                    tagsRef.current = next;
                                    if (entryIdRef.current) saveMetadata(entryIdRef.current, { tags: next });
                                }
                                setTagInput('');
                            } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                                const next = tags.slice(0, -1);
                                setTags(next);
                                tagsRef.current = next;
                                if (entryIdRef.current) saveMetadata(entryIdRef.current, { tags: next });
                            }
                        }}
                        placeholder={tags.length === 0 ? 'Add tag…' : ''}
                        className="bg-transparent text-text-primary text-xs placeholder-text-muted focus:outline-none min-w-[60px] flex-1"
                    />
                </div>
            )}

            {/* Writing Prompts Modal */}
            {showWritingPrompts && (
                <WritingPromptsPicker
                    onSelect={(prompt) => {
                        setShowWritingPrompts(false);
                        applyPrompt(prompt);
                    }}
                    onClose={() => setShowWritingPrompts(false)}
                />
            )}

            {/* Image Crop Modal */}
            {cropImageSrc && (
                <ImageCropModal
                    imageSrc={cropImageSrc}
                    onConfirm={(newUrl) => {
                        editor?.chain().focus().updateAttributes('image', { src: newUrl }).run();
                        isDirtyRef.current = true;
                        if (entryIdRef.current) performSave(entryIdRef.current, true);
                        setCropImageSrc(null);
                    }}
                    onClose={() => setCropImageSrc(null)}
                />
            )}

            <div
                ref={splitContainerRef}
                className={`flex-1 relative flex flex-col min-h-0 ${isDistractionFree ? 'max-w-4xl mx-auto w-full mt-10' : ''}`}
                onDragOver={e => {
                    // Only intercept if the drag payload contains image files
                    if (Array.from(e.dataTransfer.items).some(i => i.kind === 'file' && i.type.startsWith('image/'))) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                    }
                }}
                onDrop={handleEditorDrop}
                onContextMenu={e => {
                    e.preventDefault();
                    setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 232), y: Math.min(e.clientY, window.innerHeight - 150) });
                }}
            >
                <div style={{ height: isSplitMode ? `${splitRatio}%` : '100%' }} className="flex flex-col min-h-0 tiptap-container">
                    <EditorContent editor={editor} className="flex-1" />
                </div>

                {isSplitMode && (
                    <>
                        <div onMouseDown={handleDividerMouseDown} className="h-1 bg-border-primary hover:bg-accent-primary cursor-row-resize relative flex-shrink-0"><div className="absolute inset-x-0 -top-1 -bottom-1" /></div>
                        <div style={{ height: `${100 - splitRatio}%` }} className="flex flex-col min-h-0 tiptap-container border-t-2 border-border-primary">
                            <EditorContent editor={editor2} className="flex-1" />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
