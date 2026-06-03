"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Minimize2, Star, Hash, X, Lock, Printer, FileDown, Info } from 'lucide-react';
import Breadcrumbs from './Breadcrumbs';
import TemplatePicker, { type Template } from './TemplatePicker';
import WritingPromptsPicker from './WritingPromptsPicker';
import ImageCropModal from './ImageCropModal';
import DrawingModal from './DrawingModal';
import { extractDrawingPaths } from '@/lib/drawing';
import type { CanvasPath } from 'react-sketch-canvas';
import { type WritingPrompt } from '@/lib/prompts';
import { useLoading } from '@/contexts/LoadingContext';
import TipTapToolbar from './TipTapToolbar';
import FindBar from './FindBar';
import PromptModal, { type PromptConfig } from './PromptModal';
import { useToast } from '@/components/Toast';

import { useEditor, EditorContent, type Editor as TipTapEditor, type JSONContent } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
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
import FontFamily from '@tiptap/extension-font-family';
import { FontSize } from './extensions/FontSize';
import { Bookmark } from './extensions/Bookmark';
import { InlineTag } from './extensions/InlineTag';
import { FileAttachment } from './extensions/FileAttachment';
import { ParagraphStyle } from './extensions/ParagraphStyle';
import { SearchHighlight } from './extensions/SearchHighlight';
import { VideoBlock } from './extensions/VideoBlock';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';
import { isSafeImageUrl } from '@/lib/hotlinkImages';
import { applyBuiltins, parseTemplateVariables, substituteVariables } from '@/lib/smartTemplates';
import { TheJournalAPI } from '@/lib/pluginApi';
import { cacheEntry, getCachedEntry, invalidateEntry } from '@/lib/entryCache';
import { htmlToPlainText } from '@/lib/htmlText';
// Shared HTML-stripping count + reading-time helpers — the editor previously
// hand-rolled an `countWords` that drifted from the test-covered version.
import { wordCount as countWords, readingTimeMinutesFromWords } from '@/lib/readingTime';
import { computeEntryStats } from '@/lib/entryProperties';
import { BUNDLED_PLUGINS } from '@/lib/bundledPlugins';
import { logAction } from '@/lib/actionLog';

// Module-level (stable) helpers for the editor right-click menu so they aren't
// re-created each render (avoids react/no-unstable-nested-components).
function CtxItem({ label, kbd, onClick }: { label: string; kbd?: string; onClick: () => void }) {
    return (
        <button onClick={() => { logAction('context menu', label); onClick(); }} className="w-full text-left px-4 py-1.5 hover:bg-accent-primary hover:text-white flex items-center justify-between gap-8 text-text-primary">
            <span>{label}</span>{kbd && <kbd className="text-[10px] opacity-60 font-sans">{kbd}</kbd>}
        </button>
    );
}
function CtxSep() { return <div className="mx-2 my-1 border-t border-border-primary" />; }

type EditorProps = {
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
};

export default function Editor(props: EditorProps) {
    const [pluginsLoaded, setPluginsLoaded] = useState(false);
    const [dynamicExtensions, setDynamicExtensions] = useState<AnyExtension[]>([]);

    useEffect(() => {
        let isMounted = true;

        // Plugin loading is identical on Electron and the web build — the
        // only difference is the source:
        //   - Electron: window.electron.getPlugins() (filesystem via IPC)
        //   - Web:      GET /api/plugins (filesystem via the server)
        // Both yield the same PluginPayload[] shape so the executor below
        // doesn't care which mode we're in.
        const fetchPlugins = async (): Promise<{ id: string; scriptContent: string }[]> => {
            if (typeof window === 'undefined') return [];
            if (window.electron?.getPlugins) {
                return window.electron.getPlugins();
            }
            try {
                const res = await fetch('/api/plugins');
                if (!res.ok) return [];
                const data = await res.json() as { plugins?: { id: string; scriptContent: string }[] };
                return Array.isArray(data.plugins) ? data.plugins : [];
            } catch {
                return [];
            }
        };

        const loadPlugins = async () => {
            TheJournalAPI.reset();

            try {
                const installed = await fetchPlugins();
                if (!isMounted) return;

                // First-party plugins (drawio, sentence-diagrammer) are bundled
                // INTO the app so they always load with no runtime fetch. The
                // bundled copy is canonical and WINS over any filesystem copy of
                // the same id — otherwise a stale seeded copy (e.g. an older
                // version copied into Electron's userData/plugins on first run)
                // would shadow shipped updates. Third-party installs (ids not in
                // the bundle) load from /api/plugins as usual.
                const bundledIds = new Set(BUNDLED_PLUGINS.map(b => b.id));
                const plugins = [
                    ...BUNDLED_PLUGINS.map(b => ({ id: b.id, scriptContent: b.scriptContent })),
                    ...installed.filter(p => !bundledIds.has(p.id)),
                ];

                for (const plugin of plugins) {
                    if (!isMounted) return;
                    try {
                        new Function(plugin.scriptContent)();
                    } catch (err) {
                        console.error(`[Editor] Failed to execute plugin "${plugin.id}":`, err);
                    }
                }

                if (isMounted) {
                    setDynamicExtensions([...TheJournalAPI.registeredExtensions]);
                    setPluginsLoaded(true);
                }
            } catch (err) {
                console.error('[Editor] Failed to load plugins:', err);
                if (isMounted) setPluginsLoaded(true);
            }
        };

        loadPlugins();

        return () => {
            isMounted = false;
        };
    }, []);

    if (!pluginsLoaded) {
        return (
            <div className="flex h-full items-center justify-center bg-bg-app text-sm text-text-muted">
                Loading editor...
            </div>
        );
    }

    return <PluginLoadedEditor {...props} dynamicExtensions={dynamicExtensions} />;
}

function PluginLoadedEditor({
    categoryId,
    categoryName,
    categoryType,
    userId,
    onEnterSplitMode: onToggleSplitMode,
    isSplitMode = false,
    onOpenSearch,
    onEntryChange,
    dynamicExtensions,
}: EditorProps & { dynamicExtensions: AnyExtension[] }) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const urlDate = searchParams.get('date');
    const selectedDate = urlDate || new Date().toISOString().split('T')[0];
    const urlEntryId = searchParams.get('entry') ? parseInt(searchParams.get('entry')!, 10) : null;

    const { setLoading, clearLoading } = useLoading();

    const [entryId, setEntryId] = useState<number | null>(null);
    const [isLocked, setIsLocked] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [, setLoadingProgress] = useState<number | null>(null);
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
    const [isNewEntry, setIsNewEntry] = useState(false);
    const [isDistractionFree, setIsDistractionFree] = useState(false);
    const [, setShowDfToolbar] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    const [isFloatingToolbar, setIsFloatingToolbar] = useState(false);
    const [wordCount, setWordCount] = useState(0);

    // Sprint 2: mood, favorites, tags, writing prompts
    const [mood, setMood] = useState<string | null>(null);
    const [isFavorited, setIsFavorited] = useState(false);
    const [tags, setTags] = useState<string[]>([]);
    const [showMoodPicker, setShowMoodPicker] = useState(false);
    const [showWritingPrompts, setShowWritingPrompts] = useState(false);
    const [showProperties, setShowProperties] = useState(false);
    const [propsMeta, setPropsMeta] = useState<{ created?: string; modified?: string; title?: string }>({});
    const [toolbarHidden, setToolbarHidden] = useState(false);
    const [statusBarHidden, setStatusBarHidden] = useState(false);
    const [showFindBar, setShowFindBar] = useState(false);
    const [prompt, setPrompt] = useState<PromptConfig | null>(null);
    const { showToast } = useToast();
    const [showFontDialog, setShowFontDialog] = useState(false);
    const [showParagraphDialog, setShowParagraphDialog] = useState(false);
    const [ctxInsertOpen, setCtxInsertOpen] = useState(false);
    const [bgImage, setBgImage] = useState<string | null>(null);
    const textColorInputRef = useRef<HTMLInputElement>(null);
    const bgColorInputRef = useRef<HTMLInputElement>(null);
    const [tagInput, setTagInput] = useState('');
    const [tagSuggestions, setTagSuggestions] = useState<{ tag: string; count: number }[]>([]);
    const [tagSuggestIndex, setTagSuggestIndex] = useState(0);
    const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
    // Drawing modal: null = closed; mode 'create' inserts a new drawing,
    // mode 'edit' replaces the currently-selected drawing image.
    const [drawingState, setDrawingState] = useState<
        { mode: 'create' | 'edit'; initialPaths: CanvasPath[] | null } | null
    >(null);
    const moodRef = useRef<string | null>(null);
    const isFavoritedRef = useRef(false);
    const tagsRef = useRef<string[]>([]);

    const updateLoadingProgress = useCallback((entryId: number | null, progress: number | null) => {
        setLoadingProgress(progress);
        if (entryId !== null && progress !== null) setLoading(entryId, progress);
        else clearLoading();
    }, [setLoading, clearLoading]);

    const contentRef = useRef('');
    const documentJsonRef = useRef<JSONContent | null>(null);
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
    // J8 offers stacked (top/bottom) and side-by-side (left/right) split layouts.
    const [splitHorizontal, setSplitHorizontal] = useState(false);

    // TipTap Extensions
    const extensions = useMemo(() => [
        StarterKit,
        ResizableImage,
        // `journal` is registered so internal journal://entry/<id> links the
        // hyperlink dialog accepts actually pass TipTap's URI allowlist.
        Link.configure({ openOnClick: false, protocols: ['journal'] }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Highlight.configure({ multicolor: true }),
        Subscript,
        Superscript,
        TextStyle,
        Color,
        FontFamily,
        FontSize,
        Bookmark,
        InlineTag,
        FileAttachment,
        ParagraphStyle,
        SearchHighlight,
        VideoBlock,
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
        Markdown,
        Placeholder.configure({ placeholder: 'Start writing...' }),
        ...dynamicExtensions,
    ], [dynamicExtensions]);

    // Refs to editors — needed so onUpdate callbacks can reference the OTHER editor
    // without stale closures (useEditor hooks fire before refs are set)
    const editor1Ref = useRef<TipTapEditor | null>(null);
    const editor2Ref = useRef<TipTapEditor | null>(null);

    const handleChange = useCallback((html: string, json: JSONContent, source: string) => {
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
        editorProps: {
            attributes: { spellcheck: 'true' },
        },
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
        editorProps: {
            attributes: { spellcheck: 'true' },
        },
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

    // Lock UX: when the entry is read-only, disable TipTap input on both
    // panes. Drag/select/copy still work because TipTap's contentEditable
    // is only toggled, not removed.
    useEffect(() => {
        editor?.setEditable(!isLocked);
        editor2?.setEditable(!isLocked);
    }, [isLocked, editor, editor2]);

    const handleUnlock = useCallback(async () => {
        const id = entryIdRef.current;
        if (!id) return;
        try {
            const res = await fetch(`/api/entry/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isLocked: false }),
            });
            if (res.ok) {
                setIsLocked(false);
                window.dispatchEvent(new CustomEvent('journal-entry-updated'));
            }
        } catch { /* silence */ }
    }, []);

    // Tag autocomplete — fetches /api/tags/suggest 150 ms after the user
    // stops typing. Filters out tags already on the entry so the dropdown
    // never suggests a duplicate.
    useEffect(() => {
        const q = tagInput.trim();
        if (q.length === 0) {
            setTagSuggestions([]);
            setTagSuggestIndex(0);
            return;
        }
        const ctl = new AbortController();
        const timer = setTimeout(() => {
            fetch(`/api/tags/suggest?prefix=${encodeURIComponent(q)}&limit=8`, { signal: ctl.signal })
                .then(r => r.ok ? r.json() : { suggestions: [] })
                .then((d: { suggestions: { tag: string; count: number }[] }) => {
                    if (ctl.signal.aborted) return;
                    const fresh = (d.suggestions ?? []).filter(s => !tags.includes(s.tag));
                    setTagSuggestions(fresh);
                    setTagSuggestIndex(0);
                })
                .catch(err => { if (err?.name !== 'AbortError') setTagSuggestions([]); });
        }, 150);
        return () => { clearTimeout(timer); ctl.abort(); };
    }, [tagInput, tags]);
// Font Size Settings
    const [defaultFontSize, setDefaultFontSize] = useState(14);
    useEffect(() => {
        const loadSettings = async () => {
            let saved: Record<string, unknown> = {};
            if (window.electron) saved = await window.electron.getSettings();
            else {
                try {
                    const savedStr = localStorage.getItem('app-settings');
                    saved = savedStr ? JSON.parse(savedStr) : {};
                } catch (e) { }
            }
            if (typeof saved.defaultFontSize === 'number') setDefaultFontSize(saved.defaultFontSize);
        };
        loadSettings();

        const handleSizeChange = (e: Event) => {
            const detail = (e as CustomEvent<number>).detail;
            if (detail) setDefaultFontSize(detail);
        };
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
        // In-entry find bar (J8 Ctrl+F / F3 parity). Ctrl+F stays the global
        // cross-entry search; F3 / "Find Next" / "Find in Entry" open this bar.
        const handleFindInEntry = () => setShowFindBar(true);
        const handleTemplates = () => setShowTemplatePicker(true);
        const handleFocus = () => setIsDistractionFree(true);
        const handleSplit = () => onToggleSplitMode?.();
        const handleSplitOrientation = () => setSplitHorizontal(v => {
            const next = !v;
            try { localStorage.setItem('splitHorizontal', next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
        try { setSplitHorizontal(localStorage.getItem('splitHorizontal') === '1'); } catch { /* ignore */ }
        const handleUndo = () => editor?.chain().focus().undo().run();
        const handleRedo = () => editor?.chain().focus().redo().run();
        const handleInlineCode = () => editor?.chain().focus().toggleCode().run();
        const handleChecklist = () => editor?.chain().focus().toggleTaskList().run();
        const handleHighlight = () => editor?.chain().focus().toggleHighlight().run();
        const handleHr = () => editor?.chain().focus().setHorizontalRule().run();
        const handlePrompts = () => setShowWritingPrompts(true);

        window.addEventListener('trigger-search', handleSearch);
        window.addEventListener('trigger-find-in-entry', handleFindInEntry);
        window.addEventListener('trigger-find-next', handleFindInEntry);
        window.addEventListener('trigger-templates', handleTemplates);
        window.addEventListener('trigger-focus', handleFocus);
        window.addEventListener('trigger-split', handleSplit);
        window.addEventListener('trigger-split-orientation', handleSplitOrientation);
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
            window.removeEventListener('trigger-find-in-entry', handleFindInEntry);
            window.removeEventListener('trigger-find-next', handleFindInEntry);
            window.removeEventListener('trigger-templates', handleTemplates);
            window.removeEventListener('trigger-focus', handleFocus);
            window.removeEventListener('trigger-split', handleSplit);
            window.removeEventListener('trigger-split-orientation', handleSplitOrientation);
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
        snapshot?: { html: string; documentJson: JSONContent | null; version: number | null }
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

        const plainText = editor ? editor.getText() : htmlToPlainText(html || '');
        const derivedTitle = plainText.split('\n')[0].substring(0, 100) || 'Untitled';
        const derivedPreview = plainText.substring(0, 200);

        // Snapshot the cache key here so an in-flight save for entry A can't
        // write A's content into B's cache slot if the user navigates mid-save.
        const cacheKeyAtSave = cacheKeyRef.current;

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
                if (cacheKeyAtSave && cacheKeyAtSave !== `entry-${id}` && cacheKeyAtSave === cacheKeyRef.current) {
                    cacheEntry(cacheKeyAtSave, html, documentJson);
                }
                return true;
            }
            if (res.status === 409) {
                setSaveError(true);
                invalidateEntry(`entry-${id}`);
                if (cacheKeyAtSave) invalidateEntry(cacheKeyAtSave);
                // Surface stale-version state by clearing the in-memory version
                // so the next save round-trips and refreshes before retrying.
                versionRef.current = null;
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

    const buildSavePayload = (id: number, html: string, documentJson: JSONContent | null, version: number | null) => {
        const plainText = htmlToPlainText(html || '');
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

    // David RM Entry menu: explicit Save (Ctrl+S) flushes the autosave buffer;
    // Entry Properties opens a metadata dialog with live word/character counts.
    useEffect(() => {
        const onSave = () => flushPendingSave();
        const onProperties = async () => {
            const id = entryIdRef.current;
            if (!id) return;
            try {
                const d = await (await fetch(`/api/entry/${id}`)).json();
                setPropsMeta({ created: d?.CreatedDate, modified: d?.ModifiedDate, title: d?.Title });
            } catch { setPropsMeta({}); }
            setShowProperties(true);
        };
        const onToggleToolbar = () => setToolbarHidden(v => {
            const next = !v;
            try { localStorage.setItem('toolbarHidden', next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
        try { setToolbarHidden(localStorage.getItem('toolbarHidden') === '1'); } catch { /* ignore */ }
        const onToggleStatusBar = () => setStatusBarHidden(v => {
            const next = !v;
            try { localStorage.setItem('statusBarHidden', next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
        try { setStatusBarHidden(localStorage.getItem('statusBarHidden') === '1'); } catch { /* ignore */ }
        window.addEventListener('trigger-save', onSave);
        window.addEventListener('trigger-entry-properties', onProperties);
        window.addEventListener('trigger-toggle-toolbar', onToggleToolbar);
        window.addEventListener('trigger-toggle-status-bar', onToggleStatusBar);
        return () => {
            window.removeEventListener('trigger-save', onSave);
            window.removeEventListener('trigger-entry-properties', onProperties);
            window.removeEventListener('trigger-toggle-toolbar', onToggleToolbar);
            window.removeEventListener('trigger-toggle-status-bar', onToggleStatusBar);
        };
    }, [flushPendingSave]);

    // Format/Insert menu actions that map to editor commands (David RM Format
    // & Insert menus), plus per-entry lock toggle.
    useEffect(() => {
        if (!editor) return;
        const chain = () => editor.chain().focus();
        const handlers: Record<string, () => void> = {
            'trigger-insert-table': () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
            'trigger-style-normal': () => chain().setParagraph().run(),
            'trigger-style-h1': () => chain().toggleHeading({ level: 1 }).run(),
            'trigger-style-h2': () => chain().toggleHeading({ level: 2 }).run(),
            'trigger-style-h3': () => chain().toggleHeading({ level: 3 }).run(),
            'trigger-style-quote': () => chain().toggleBlockquote().run(),
            'trigger-style-code': () => chain().toggleCodeBlock().run(),
            'trigger-bullets-numbering': () => chain().toggleBulletList().run(),
            'trigger-text-color': () => textColorInputRef.current?.click(),
            'trigger-font-properties': () => setShowFontDialog(true),
            'trigger-paragraph-properties': () => setShowParagraphDialog(true),
        };
        const onLock = () => {
            const id = entryIdRef.current;
            if (!id) return;
            if (isLocked) {
                setPrompt({
                    title: 'Unlock entry',
                    message: 'Enter the password to unlock and decrypt this entry.',
                    inputType: 'password',
                    confirmLabel: 'Unlock',
                    onConfirm: async (pw) => {
                        const res = await fetch(`/api/entry/${id}/lock`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
                        if (res.ok) { window.location.reload(); return null; }
                        return 'Wrong password or unlock failed.';
                    },
                });
            } else {
                setPrompt({
                    title: 'Lock entry',
                    message: 'Set a password to lock this entry. Its content is encrypted at rest; there is no recovery if you forget it.',
                    inputType: 'password',
                    confirmLabel: 'Lock',
                    onConfirm: async (pw) => {
                        if (!pw) return 'Enter a password.';
                        await flushPendingSave();
                        const res = await fetch(`/api/entry/${id}/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
                        if (res.ok) { window.location.reload(); return null; }
                        return 'Lock failed.';
                    },
                });
            }
        };
        // Run a plugin's registered action by id (from the Plugins menu).
        const onRunPlugin = (e: Event) => {
            const id = (e as CustomEvent<{ id?: string }>).detail?.id;
            if (!id) return;
            const btn = TheJournalAPI.registeredToolbarButtons.find(b => b.id === id);
            logAction('plugin', `run-plugin:${id}`, { found: !!btn });
            if (btn) btn.onClick(editor);
            else showToast(`Plugin "${id}" is not loaded.`, 'error');
        };
        for (const [evt, fn] of Object.entries(handlers)) window.addEventListener(evt, fn);
        window.addEventListener('trigger-lock-entry', onLock);
        window.addEventListener('trigger-run-plugin', onRunPlugin);
        return () => {
            for (const [evt, fn] of Object.entries(handlers)) window.removeEventListener(evt, fn);
            window.removeEventListener('trigger-lock-entry', onLock);
            window.removeEventListener('trigger-run-plugin', onRunPlugin);
        };
    }, [editor, isLocked, flushPendingSave, showToast]);

    // Per-entry background image (David RM context-menu "Background Image").
    // Persisted in localStorage keyed by entry so it survives reloads.
    useEffect(() => {
        if (!entryId) { setBgImage(null); return; }
        try { setBgImage(localStorage.getItem(`entryBg-${entryId}`)); } catch { setBgImage(null); }
    }, [entryId]);

    const setBackgroundImage = useCallback(() => {
        const id = entryIdRef.current;
        if (!id) return;
        const current = (() => { try { return localStorage.getItem(`entryBg-${id}`) ?? ''; } catch { return ''; } })();
        setPrompt({
            title: 'Background image',
            message: 'Image URL to show behind this entry. Leave blank to clear.',
            initialValue: current,
            placeholder: 'https://…',
            allowEmpty: true,
            confirmLabel: 'Apply',
            onConfirm: (url) => {
                const trimmed = url.trim();
                try {
                    if (trimmed) localStorage.setItem(`entryBg-${id}`, trimmed);
                    else localStorage.removeItem(`entryBg-${id}`);
                } catch { /* ignore */ }
                setBgImage(trimmed || null);
            },
        });
    }, []);

    const saveEntryAs = useCallback(() => {
        const id = entryIdRef.current;
        if (!id) return;
        setPrompt({
            title: 'Save entry as',
            message: 'Choose a format to export this entry.',
            options: [
                { value: 'html', label: 'HTML (.html)' },
                { value: 'md', label: 'Markdown (.md)' },
                { value: 'rtf', label: 'Rich Text (.rtf)' },
                { value: 'txt', label: 'Plain text (.txt)' },
            ],
            initialValue: 'html',
            confirmLabel: 'Export',
            onConfirm: (fmt) => { window.open(`/api/entry/${id}/export?format=${fmt}`, '_blank'); },
        });
    }, []);

    // Inline (block-level) topic tagging: tag the SELECTED text with a topic.
    // Fetches the user's topics, lets them pick one, and applies the InlineTag
    // mark to the selection (round-trips in the entry HTML). With an empty
    // selection it offers to remove an inline tag at the cursor instead.
    const tagSelectionFlow = useCallback(async () => {
        if (!editor) return;
        const { from, to } = editor.state.selection;
        if (from === to) {
            if (editor.isActive('inlineTag')) editor.chain().focus().unsetInlineTag().run();
            else showToast('Select some text to tag it with a topic.');
            return;
        }
        let topics: { Name?: string; name?: string; Color?: string; color?: string }[] = [];
        try {
            const res = await fetch('/api/topic');
            topics = res.ok ? await res.json() : [];
        } catch { /* offline — fall through to empty */ }
        if (!Array.isArray(topics) || topics.length === 0) {
            showToast('No topics defined yet. Create topics first (Topic ▸ Manage Topics).');
            return;
        }
        const nameOf = (t: { Name?: string; name?: string }) => t.Name ?? t.name ?? '';
        const colorOf = (t: { Color?: string; color?: string }) => t.Color ?? t.color ?? '#888888';
        setPrompt({
            title: 'Tag selection with topic',
            message: 'Apply an inline topic tag to the selected text.',
            options: topics.map(t => ({ value: nameOf(t), label: nameOf(t) })),
            initialValue: nameOf(topics[0]),
            confirmLabel: 'Tag',
            onConfirm: (name) => {
                const t = topics.find(x => nameOf(x) === name);
                editor.chain().focus().setInlineTag(name, t ? colorOf(t) : undefined).run();
            },
        });
    }, [editor, showToast]);

    useEffect(() => {
        const onTagSelection = () => { void tagSelectionFlow(); };
        window.addEventListener('trigger-tag-selection', onTagSelection);
        return () => window.removeEventListener('trigger-tag-selection', onTagSelection);
    }, [tagSelectionFlow]);

    // Context-menu "Paste": native paste preserves formatting (works in Electron
    // and supporting browsers); fall back to the async clipboard as plain text.
    const ctxPaste = useCallback(async () => {
        if (!editor) return;
        try { if (document.execCommand('paste')) return; } catch { /* gated */ }
        try { const t = await navigator.clipboard.readText(); if (t) editor.chain().focus().insertContent(t).run(); } catch { /* no permission */ }
    }, [editor]);

    const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const onMouseMove = (ev: MouseEvent) => {
            if (!splitContainerRef.current) return;
            const rect = splitContainerRef.current.getBoundingClientRect();
            const ratio = splitHorizontal
                ? ((ev.clientX - rect.left) / rect.width) * 100
                : ((ev.clientY - rect.top) / rect.height) * 100;
            setSplitRatio(Math.max(20, Math.min(80, ratio)));
        };
        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.removeProperty('cursor');
            document.body.style.removeProperty('user-select');
        };
        document.body.style.cursor = splitHorizontal ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [splitHorizontal]);

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

            // sendBeacon issues a POST (route aliases POST → PUT) and is the
            // only reliable way to ship data during unload. Modern browsers
            // block sync XHR in beforeunload and Chrome warns/freezes the tab —
            // so if the beacon is rejected (e.g. > 64KB payload limit) we rely
            // on the localStorage backup written above and recover on reopen.
            const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
            navigator.sendBeacon(url, blob);

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
        setIsLocked(false);

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

        const setContentSafely = (json: JSONContent | null, html: string) => {
            if (!isMounted || renderAbort.signal.aborted) return;

            const applyContent = (ed: TipTapEditor | null) => {
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

                    type EntryMeta = { Mood?: string | null; IsFavorited?: number | boolean; Tags?: string | null; IsLocked?: number | boolean };
                    const applyMeta = (d: EntryMeta | null | undefined) => {
                        if (!d) return;
                        const m = d.Mood ?? null;
                        const f = !!d.IsFavorited;
                        let t: string[] = [];
                        try { t = d.Tags ? JSON.parse(d.Tags) : []; } catch { t = []; }
                        setMood(m); setIsFavorited(f); setTags(t);
                        moodRef.current = m; isFavoritedRef.current = f; tagsRef.current = t;
                        setIsLocked(!!d.IsLocked);
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

                // The two endpoints used below — GET /api/entry/:id and POST
                // /api/entry/by-date — return slightly different shapes (DB
                // column casing vs. lowercase camel for the by-date "new"
                // response). Union both forms so the access patterns below
                // type-check without per-field guards.
                type EntryPayload = {
                    EntryID?: number;
                    id?: number;
                    Title?: string;
                    HtmlContent?: string;
                    html?: string;
                    DocumentJson?: string | JSONContent | null;
                    documentJson?: string | JSONContent | null;
                    Version?: number;
                    Mood?: string | null;
                    IsFavorited?: number | boolean;
                    IsLocked?: number | boolean;
                    Tags?: string | null;
                    isNew?: boolean;
                };
                let data: EntryPayload | null = null;
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
                    const loadedId = (data.EntryID ?? data.id) as number;
                    let loadedHtml = data.HtmlContent || data.html || '';
                    const rawDocJson = data.DocumentJson ?? data.documentJson ?? null;
                    // DB-stored docs come back as TEXT (string); the by-date "new"
                    // response returns an already-parsed object. Normalize.
                    let loadedDocumentJson: JSONContent | null = null;
                    if (typeof rawDocJson === 'string') {
                        try { loadedDocumentJson = JSON.parse(rawDocJson) as JSONContent; } catch { loadedDocumentJson = null; }
                    } else if (rawDocJson && typeof rawDocJson === 'object') {
                        loadedDocumentJson = rawDocJson as JSONContent;
                    }

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
                    setIsLocked(!!data.IsLocked);
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
        const body: Record<string, unknown> = {};
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

    /** Upload a media File and return the attachment URL + media kind, or null on failure. */
    const uploadMediaFile = useCallback(async (file: File): Promise<{ url: string; kind: 'image' | 'video'; mimeType: string } | null> => {
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
            return { url: data.url as string, kind: (data.kind as 'image' | 'video') ?? 'image', mimeType: (data.mimeType as string) ?? file.type };
        } catch (err) {
            console.error('[Editor] media upload failed:', err);
            return null;
        }
    }, []);

    /** Insert an uploaded image at the cursor. */
    const insertImage = useCallback((url: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ResizableImage extension adds width but its type isn't picked up by TipTap's command map
        editor?.chain().focus().setImage({ src: url, width: '100%' } as any).run();
        isDirtyRef.current = true;
        if (entryIdRef.current) performSave(entryIdRef.current, true);
    }, [editor, performSave]);

    /** Insert an uploaded video at the cursor. */
    const insertVideo = useCallback((url: string, mimeType: string) => {
        editor?.chain().focus().insertContent({
            type: 'videoBlock',
            attrs: { src: url, mimeType, width: '100%' },
        }).run();
        isDirtyRef.current = true;
        if (entryIdRef.current) performSave(entryIdRef.current, true);
    }, [editor, performSave]);

    // Drag-and-drop images / videos onto the editor area
    const handleEditorDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
        const mediaFiles = Array.from(e.dataTransfer.files).filter(
            f => f.type.startsWith('image/') || f.type.startsWith('video/'),
        );
        if (mediaFiles.length === 0) return; // not media files — let default DnD handle it
        e.preventDefault();
        for (const file of mediaFiles) {
            const res = await uploadMediaFile(file);
            if (!res) continue;
            if (res.kind === 'video') insertVideo(res.url, res.mimeType);
            else insertImage(res.url);
        }
    }, [uploadMediaFile, insertImage, insertVideo]);

    // Paste images from clipboard (e.g. screenshots) OR hot-link an image URL
    useEffect(() => {
        if (!editor) return;
        const handlePaste = async (e: ClipboardEvent) => {
            if (!editor.isFocused) return;
            const items = Array.from(e.clipboardData?.items ?? []);

            // First check for pasted image-URL text — hot-link without uploading
            const text = e.clipboardData?.getData('text/plain')?.trim();
            if (text && /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?\S*)?(#\S*)?$/i.test(text)) {
                if (isSafeImageUrl(text)) {
                    e.preventDefault();
                    insertImage(text);
                    return;
                }
            }

            const imageItem = items.find(i => i.type.startsWith('image/'));
            if (!imageItem) return;
            e.preventDefault();
            const file = imageItem.getAsFile();
            if (!file) return;
            const res = await uploadMediaFile(file);
            const url = res?.url ?? null;
            if (url) insertImage(url);
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [editor, uploadMediaFile, insertImage]);

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

    // Insert-drawing trigger from toolbar → open a blank canvas.
    useEffect(() => {
        const handler = () => setDrawingState({ mode: 'create', initialPaths: null });
        window.addEventListener('trigger-insert-drawing', handler);
        return () => window.removeEventListener('trigger-insert-drawing', handler);
    }, []);

    // Edit-drawing trigger from toolbar → fetch the selected drawing SVG,
    // recover its editable strokes, and reopen the canvas to edit them.
    useEffect(() => {
        const handler = async () => {
            if (!editor?.isActive('image')) return;
            const src = editor.getAttributes('image').src as string | undefined;
            if (!src) return;
            try {
                const res = await fetch(src, { credentials: 'same-origin' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const svg = await res.text();
                const paths = extractDrawingPaths(svg);
                if (!paths) {
                    showToast('This image is not an editable drawing.', 'error');
                    return;
                }
                setDrawingState({ mode: 'edit', initialPaths: paths });
            } catch (err) {
                console.error('[Editor] failed to load drawing for edit:', err);
                showToast('Could not load this drawing for editing.', 'error');
            }
        };
        window.addEventListener('trigger-edit-drawing', handler);
        return () => window.removeEventListener('trigger-edit-drawing', handler);
    }, [editor, showToast]);

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
            // Smart template substitution: scan for {{prompt:Question?}} placeholders first.
            // For each, ask the user via prompt(). Then apply built-in {{date}}, {{title}}, etc.
            const rawHtml = template.HtmlContent ?? '';
            const vars = parseTemplateVariables(rawHtml);
            const promptValues: Record<string, string> = {};
            for (const v of vars) {
                if (v.key === 'prompt' && v.arg) {
                    const answer = window.prompt(v.arg, '');
                    if (answer !== null) {
                        const placeholder = v.raw.replace(/^\{\{|\}\}$/g, '').trim();
                        promptValues[placeholder] = answer;
                    }
                }
            }
            let processedHtml = substituteVariables(rawHtml, promptValues);
            processedHtml = applyBuiltins(processedHtml, { title: template.Name ?? '' });

            // We've materialized prompt + builtin substitutions into HTML.
            // Always use HtmlContent so the substitutions land in the editor.
            if (processedHtml) {
                editor.commands.setContent(processedHtml, { emitUpdate: false });
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

            {entryId && !isDistractionFree && !statusBarHidden && (
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
                            <span className="text-[10px] text-text-muted tabular-nums select-none" title="Word count and approximate reading time">
                                {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
                                <span className="mx-1 opacity-50">·</span>
                                {readingTimeMinutesFromWords(wordCount)} min read
                            </span>
                        )}

                        <button
                            onClick={() => window.dispatchEvent(new Event('trigger-entry-properties'))}
                            className="p-1 rounded hover:bg-bg-hover text-text-muted transition-colors"
                            title="Entry properties"
                        >
                            <Info className="w-3.5 h-3.5" />
                        </button>

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

                        <button
                            onClick={() => window.dispatchEvent(new Event('trigger-print-entry'))}
                            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
                            title="Print entry"
                        >
                            <Printer className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => window.dispatchEvent(new Event('trigger-export-pdf'))}
                            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
                            title="Export entry as PDF"
                        >
                            <FileDown className="w-4 h-4" />
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

            {isLocked && !isDistractionFree && (
                <div className="bg-yellow-500/10 border border-yellow-500/40 text-yellow-300 px-4 py-2 flex items-center justify-between text-sm flex-shrink-0">
                    <span className="flex items-center gap-2 font-semibold">
                        <Lock className="w-3.5 h-3.5" />
                        This entry is read-only.
                    </span>
                    <button
                        onClick={handleUnlock}
                        className="ml-4 px-3 py-1 bg-yellow-500/80 text-black rounded text-xs hover:bg-yellow-500 font-bold"
                    >
                        Unlock
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
                <div
                    className="fixed z-[300] bg-bg-card border border-border-primary rounded-lg shadow-xl py-1 min-w-[240px] text-sm"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={e => e.stopPropagation()}
                >
                    {(() => {
                        const run = (fn: () => void) => () => { fn(); setContextMenu(null); };
                        const dispatch = (evt: string) => () => { window.dispatchEvent(new Event(evt)); setContextMenu(null); };
                        const Item = CtxItem;
                        const Sep = CtxSep;
                        const insertItems: [string, string][] = [
                            ['File Attachment…', 'trigger-attachment'],
                            ['Image / Photo…', 'trigger-image-upload'],
                            ['Hyperlink…', 'trigger-link'],
                            ['Table…', 'trigger-insert-table'],
                            ['Horizontal Line', 'trigger-hr'],
                            ['Special Character…', 'trigger-special-char'],
                            ['Bookmark…', 'trigger-bookmark'],
                        ];
                        return (
                            <>
                                <Item label="Cut" kbd="Ctrl+X" onClick={run(() => document.execCommand('cut'))} />
                                <Item label="Copy" kbd="Ctrl+C" onClick={run(() => document.execCommand('copy'))} />
                                <Item label="Paste" kbd="Ctrl+V" onClick={run(() => { void ctxPaste(); })} />
                                <Item label="Paste as Text" kbd="Ctrl+Shift+V" onClick={dispatch('trigger-paste-special')} />
                                <Item label="Select All" kbd="Ctrl+A" onClick={run(() => editor?.chain().focus().selectAll().run())} />
                                <Sep />
                                <Item label="Format Painter" onClick={dispatch('trigger-format-painter')} />
                                <Item label="Highlighter" onClick={run(() => editor?.chain().focus().toggleHighlight().run())} />
                                <Sep />
                                <Item label="Font…" onClick={run(() => setShowFontDialog(true))} />
                                <Item label="Paragraph…" onClick={run(() => setShowParagraphDialog(true))} />
                                <Item label="Background Color" onClick={run(() => bgColorInputRef.current?.click())} />
                                <Item label="Background Image" onClick={run(setBackgroundImage)} />
                                <Sep />
                                <Item label="Tag Entry with Topic…" kbd="Ctrl+Shift+G" onClick={dispatch('trigger-assign-topics')} />
                                <Item label="Tag Selection with Topic…" onClick={dispatch('trigger-tag-selection')} />
                                <div
                                    className="relative"
                                    onMouseEnter={() => setCtxInsertOpen(true)}
                                    onMouseLeave={() => setCtxInsertOpen(false)}
                                >
                                    <div className="w-full text-left px-4 py-1.5 hover:bg-accent-primary hover:text-white flex items-center justify-between gap-8 text-text-primary cursor-default">
                                        <span>Insert</span><span className="opacity-60">›</span>
                                    </div>
                                    {ctxInsertOpen && (
                                        <div className="absolute left-full top-0 -mt-1 bg-bg-card border border-border-primary rounded-lg shadow-xl py-1 min-w-[200px]">
                                            {insertItems.map(([label, evt]) => <Item key={evt} label={label} onClick={dispatch(evt)} />)}
                                        </div>
                                    )}
                                </div>
                                <Item label="Insert Template" onClick={run(() => setShowTemplatePicker(true))} />
                                <Sep />
                                <Item label="Save Entry As…" kbd="F12" onClick={run(saveEntryAs)} />
                                <Item label="Entry Information & Statistics" onClick={dispatch('trigger-entry-properties')} />
                            </>
                        );
                    })()}
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

            <input
                ref={textColorInputRef}
                type="color"
                className="hidden"
                onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()}
            />
            <input
                ref={bgColorInputRef}
                type="color"
                className="hidden"
                onChange={(e) => editor?.chain().focus().setHighlight({ color: e.target.value }).run()}
            />

            {showFontDialog && editor && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40" onClick={() => setShowFontDialog(false)}>
                    <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl p-5 w-[320px] space-y-3" onClick={e => e.stopPropagation()}>
                        <div className="text-sm font-semibold text-text-primary">Font Properties</div>
                        <div>
                            <label className="block text-xs text-text-muted mb-1">Font family</label>
                            <select value={editor.getAttributes('textStyle').fontFamily || ''}
                                onChange={e => { const v = e.target.value; v ? editor.chain().focus().setFontFamily(v).run() : editor.chain().focus().unsetFontFamily().run(); }}
                                className="w-full p-2 text-sm bg-bg-app border border-border-primary rounded text-text-primary">
                                <option value="">Default</option>
                                <option value="Inter, sans-serif">Inter</option>
                                <option value="Arial, sans-serif">Arial</option>
                                <option value="Georgia, serif">Georgia</option>
                                <option value="'Times New Roman', serif">Times Roman</option>
                                <option value="'Courier New', monospace">Courier New</option>
                                <option value="Verdana, sans-serif">Verdana</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-text-muted mb-1">Size</label>
                            <select value={editor.getAttributes('textStyle').fontSize || ''}
                                onChange={e => { const v = e.target.value; v ? editor.chain().focus().setFontSize(v).run() : editor.chain().focus().unsetFontSize().run(); }}
                                className="w-full p-2 text-sm bg-bg-app border border-border-primary rounded text-text-primary">
                                <option value="">Default</option>
                                {['12px','14px','16px','18px','20px','24px','28px','32px','36px'].map(s => <option key={s} value={s}>{s.replace('px','')}</option>)}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-text-muted">Text color</label>
                            <input type="color" onChange={e => editor.chain().focus().setColor(e.target.value).run()} className="h-7 w-12 bg-transparent" />
                        </div>
                        <div className="flex justify-end"><button onClick={() => setShowFontDialog(false)} className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90">Done</button></div>
                    </div>
                </div>
            )}

            {showParagraphDialog && editor && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40" onClick={() => setShowParagraphDialog(false)}>
                    <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl p-5 w-[320px] space-y-3" onClick={e => e.stopPropagation()}>
                        <div className="text-sm font-semibold text-text-primary">Paragraph Adjustments</div>
                        <div>
                            <label className="block text-xs text-text-muted mb-1">Alignment</label>
                            <div className="flex gap-1">
                                {(['left','center','right','justify'] as const).map(a => (
                                    <button key={a} onClick={() => editor.chain().focus().setTextAlign(a).run()}
                                        className={`flex-1 px-2 py-1 text-xs rounded border border-border-primary ${editor.isActive({ textAlign: a }) ? 'bg-accent-primary text-white' : 'text-text-primary hover:bg-bg-hover'}`}>{a}</button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-text-muted mb-1">Line spacing</label>
                            <select value={editor.getAttributes('paragraph').lineHeight || editor.getAttributes('heading').lineHeight || ''}
                                onChange={e => { const v = e.target.value; v ? editor.chain().focus().setLineHeight(v).run() : editor.chain().focus().unsetLineHeight().run(); }}
                                className="w-full p-2 text-sm bg-bg-app border border-border-primary rounded text-text-primary">
                                <option value="">Default</option>
                                {['1','1.15','1.5','2'].map(h => <option key={h} value={h}>{h}×</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-text-muted mb-1">Indent</label>
                            <div className="flex gap-2">
                                <button onClick={() => editor.chain().focus().outdentBlock().run()} className="flex-1 px-2 py-1 text-xs rounded border border-border-primary text-text-primary hover:bg-bg-hover">Decrease</button>
                                <button onClick={() => editor.chain().focus().indentBlock().run()} className="flex-1 px-2 py-1 text-xs rounded border border-border-primary text-text-primary hover:bg-bg-hover">Increase</button>
                            </div>
                        </div>
                        <div className="flex justify-end"><button onClick={() => setShowParagraphDialog(false)} className="px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90">Done</button></div>
                    </div>
                </div>
            )}

            {!toolbarHidden && !isFloatingToolbar && !isDistractionFree && <TipTapToolbar editor={editor} />}
            {!toolbarHidden && isFloatingToolbar && editor && !isDistractionFree && (
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
                    <div className="relative flex-1 min-w-[60px]">
                        <input
                            type="text"
                            value={tagInput}
                            onChange={e => setTagInput(e.target.value)}
                            onKeyDown={e => {
                                // Autocomplete navigation. ArrowDown/ArrowUp move the
                                // highlight; Tab or Enter on a highlighted suggestion
                                // accepts it; Enter on a free-form prefix still creates
                                // a new tag (David RM lets users coin tags inline).
                                if (tagSuggestions.length > 0) {
                                    if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setTagSuggestIndex(i => (i + 1) % tagSuggestions.length);
                                        return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setTagSuggestIndex(i => (i - 1 + tagSuggestions.length) % tagSuggestions.length);
                                        return;
                                    }
                                    if (e.key === 'Tab') {
                                        e.preventDefault();
                                        const pick = tagSuggestions[tagSuggestIndex]?.tag;
                                        if (pick) setTagInput(pick);
                                        return;
                                    }
                                    if (e.key === 'Escape') {
                                        setTagSuggestions([]);
                                        return;
                                    }
                                }
                                if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                                    e.preventDefault();
                                    const highlighted = tagSuggestions.length > 0
                                        ? tagSuggestions[tagSuggestIndex]?.tag
                                        : undefined;
                                    const newTag = (highlighted ?? tagInput)
                                        .trim()
                                        .replace(/,+$/, '')
                                        .toLowerCase();
                                    if (newTag && !tags.includes(newTag) && tags.length < 10) {
                                        const next = [...tags, newTag];
                                        setTags(next);
                                        tagsRef.current = next;
                                        if (entryIdRef.current) saveMetadata(entryIdRef.current, { tags: next });
                                    }
                                    setTagInput('');
                                    setTagSuggestions([]);
                                } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                                    const next = tags.slice(0, -1);
                                    setTags(next);
                                    tagsRef.current = next;
                                    if (entryIdRef.current) saveMetadata(entryIdRef.current, { tags: next });
                                }
                            }}
                            onBlur={() => { setTimeout(() => setTagSuggestions([]), 100); }}
                            placeholder={tags.length === 0 ? 'Add tag…' : ''}
                            className="bg-transparent text-text-primary text-xs placeholder-text-muted focus:outline-none w-full"
                        />
                        {tagSuggestions.length > 0 && (
                            <div className="absolute left-0 top-full mt-1 z-50 bg-bg-card border border-border-primary rounded shadow-xl py-1 min-w-[160px] max-h-48 overflow-y-auto">
                                {tagSuggestions.map((s, i) => (
                                    <button
                                        key={s.tag}
                                        // Use onMouseDown — onClick fires after input blur, which
                                        // would clear suggestions before we read the picked tag.
                                        onMouseDown={ev => {
                                            ev.preventDefault();
                                            if (!tags.includes(s.tag) && tags.length < 10) {
                                                const next = [...tags, s.tag];
                                                setTags(next);
                                                tagsRef.current = next;
                                                if (entryIdRef.current) saveMetadata(entryIdRef.current, { tags: next });
                                            }
                                            setTagInput('');
                                            setTagSuggestions([]);
                                        }}
                                        className={`w-full text-left px-3 py-1 text-xs hover:bg-bg-hover flex items-center justify-between ${i === tagSuggestIndex ? 'bg-bg-hover' : ''}`}
                                    >
                                        <span className="text-text-primary">{s.tag}</span>
                                        <span className="text-text-muted text-[10px]">{s.count}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
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

            {/* Entry Properties Modal (David RM) */}
            {showProperties && (() => {
                const stats = computeEntryStats(contentRef.current);
                const fmt = (s?: string) => s ? new Date(s).toLocaleString() : '—';
                const rows: [string, string][] = [
                    ['Title', propsMeta.title || 'Untitled'],
                    ['Entry ID', String(entryId ?? '—')],
                    ['Created', fmt(propsMeta.created)],
                    ['Modified', fmt(propsMeta.modified)],
                    ['Words', stats.words.toLocaleString()],
                    ['Characters', stats.characters.toLocaleString()],
                    ['Characters (no spaces)', stats.charactersNoSpaces.toLocaleString()],
                    ['Reading time', `${readingTimeMinutesFromWords(stats.words)} min`],
                ];
                return (
                    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40" onClick={() => setShowProperties(false)}>
                        <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl p-5 w-[360px]" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-3">
                                <div className="text-sm font-semibold text-text-primary">Entry Properties</div>
                                <button onClick={() => setShowProperties(false)} className="p-1 rounded hover:bg-bg-hover text-text-muted"><X className="w-4 h-4" /></button>
                            </div>
                            <dl className="space-y-1.5">
                                {rows.map(([k, v]) => (
                                    <div key={k} className="flex justify-between gap-4 text-xs">
                                        <dt className="text-text-muted flex-shrink-0">{k}</dt>
                                        <dd className="text-text-primary text-right break-words">{v}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    </div>
                );
            })()}

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

            {/* Drawing Modal — freehand sketch, create or edit existing */}
            {drawingState && (
                <DrawingModal
                    initialPaths={drawingState.initialPaths}
                    onConfirm={(url) => {
                        if (drawingState.mode === 'edit') {
                            // Cache-bust so the <img> reloads the updated SVG.
                            const bust = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ResizableImage width attr isn't in TipTap's command map
                            editor?.chain().focus().updateAttributes('image', { src: bust, alt: 'tj-drawing' } as any).run();
                        } else {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ResizableImage width attr isn't in TipTap's command map
                            editor?.chain().focus().setImage({ src: url, width: '100%', alt: 'tj-drawing' } as any).run();
                        }
                        isDirtyRef.current = true;
                        if (entryIdRef.current) performSave(entryIdRef.current, true);
                        setDrawingState(null);
                    }}
                    onClose={() => setDrawingState(null)}
                />
            )}

            <div
                ref={splitContainerRef}
                className={`flex-1 relative flex min-h-0 ${isSplitMode && splitHorizontal ? 'flex-row' : 'flex-col'} ${isDistractionFree ? 'max-w-4xl mx-auto w-full mt-10' : ''}`}
                onDragOver={e => {
                    // Only intercept if the drag payload contains image files
                    if (Array.from(e.dataTransfer.items).some(i => i.kind === 'file' && i.type.startsWith('image/'))) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                    }
                }}
                onDrop={handleEditorDrop}
                onClick={(e) => {
                    // Intercept clicks on internal journal:// links
                    const target = (e.target as HTMLElement).closest('a');
                    if (!target) return;
                    const href = target.getAttribute('href') ?? '';
                    const m = href.match(/^journal:\/\/entry\/(\d+)$/);
                    if (m) {
                        e.preventDefault();
                        const params = new URLSearchParams(window.location.search);
                        params.set('entry', m[1]);
                        params.delete('folder');
                        params.delete('section');
                        router.push(`${pathname}?${params.toString()}`);
                    }
                }}
                onContextMenu={e => {
                    e.preventDefault();
                    setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 232), y: Math.min(e.clientY, window.innerHeight - 150) });
                }}
            >
                {showFindBar && <FindBar editor={editor} secondaryEditor={isSplitMode ? editor2 : null} onClose={() => setShowFindBar(false)} />}
                {prompt && <PromptModal config={prompt} onClose={() => setPrompt(null)} />}
                <div
                    style={{
                        ...(isSplitMode
                            ? (splitHorizontal ? { width: `${splitRatio}%` } : { height: `${splitRatio}%` })
                            : { height: '100%' }),
                        ...(bgImage ? { backgroundImage: `url("${bgImage}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'local' } : {}),
                    }}
                    className="flex flex-col min-h-0 min-w-0 tiptap-container"
                >
                    <EditorContent editor={editor} className="flex-1" />
                </div>

                {isSplitMode && (
                    <>
                        <div
                            onMouseDown={handleDividerMouseDown}
                            className={`bg-border-primary hover:bg-accent-primary relative flex-shrink-0 ${splitHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}`}
                        >
                            <div className={splitHorizontal ? 'absolute inset-y-0 -left-1 -right-1' : 'absolute inset-x-0 -top-1 -bottom-1'} />
                        </div>
                        <div
                            style={splitHorizontal ? { width: `${100 - splitRatio}%` } : { height: `${100 - splitRatio}%` }}
                            className={`flex flex-col min-h-0 min-w-0 tiptap-container ${splitHorizontal ? 'border-l-2' : 'border-t-2'} border-border-primary`}
                        >
                            <EditorContent editor={editor2} className="flex-1" />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
