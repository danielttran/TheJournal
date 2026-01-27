"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import hljs from 'highlight.js';
import 'react-quill-new/dist/quill.snow.css';

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useSearchParams } from 'next/navigation';

import Breadcrumbs from './Breadcrumbs';

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

export default function Editor({ categoryId, userId }: { categoryId: string, userId: string }) {
    const searchParams = useSearchParams();
    const urlDate = searchParams.get('date');
    const selectedDate = urlDate || new Date().toISOString().split('T')[0];
    const urlEntryId = searchParams.get('entry') ? parseInt(searchParams.get('entry')!, 10) : null;

    const [entryId, setEntryId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState<number | null>(null);

    // Refs for Data Safety
    const contentRef = useRef('');
    const deltaRef = useRef<any>(null);
    const entryIdRef = useRef<number | null>(null);
    const isDirtyRef = useRef(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const quillRef = useRef<any>(null);

    // SAFETY GUARD
    const isFullyLoadedRef = useRef(false);

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
                return true;
            }
            throw new Error(`HTTP ${res.status}`);

        } catch (err) {
            console.error("Save failed", err);
            if (retryCount < 3) {
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, retryCount)));
                return performSave(id, isAutoSave, retryCount + 1);
            }
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

    // Unmount Save - Uses refs only
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            if (isDirtyRef.current && entryIdRef.current && isFullyLoadedRef.current) {
                console.log("Saving on unmount for entry", entryIdRef.current);
                performSave(entryIdRef.current, false);
            }
        };
    }, [urlEntryId, selectedDate, performSave]);

    // CORRECTED LOADING LOGIC
    const loadContentSafely = useCallback(async (html: string | null, delta: any | null) => {
        if (!quillRef.current) {
            setTimeout(() => loadContentSafely(html, delta), 100);
            return;
        }

        const quill = quillRef.current.getEditor();

        // Check if delta is valid and usable
        const isValidDelta = delta && delta.ops && Array.isArray(delta.ops) && delta.ops.length > 0;

        // SIMPLE PATH: Small content - just load it directly
        const LARGE_THRESHOLD = 500000; // 500KB
        const contentSize = isValidDelta
            ? JSON.stringify(delta).length
            : (html?.length || 0);

        if (contentSize < LARGE_THRESHOLD) {
            // Direct load - fast and simple
            console.log("Loading directly (small content):", contentSize, "chars");
            setLoadingProgress(0);

            if (isValidDelta) {
                quill.setContents(delta, 'api');
            } else if (html) {
                quill.clipboard.dangerouslyPasteHTML(html, 'api');
            }

            // Sync refs
            contentRef.current = quill.root.innerHTML;
            deltaRef.current = quill.getContents();

            setLoadingProgress(null);
            isFullyLoadedRef.current = true;
            return;
        }

        // LARGE CONTENT PATH - Chunked loading with progress
        console.log("Loading chunked (large content):", contentSize, "chars");
        setLoadingProgress(0);
        quill.enable(false);
        quill.setText(''); // Clear first

        if (isValidDelta) {
            // Delta chunking
            let ops = delta.ops;

            // Split huge text inserts
            const processedOps: any[] = [];
            for (const op of ops) {
                if (typeof op.insert === 'string' && op.insert.length > 10000) {
                    const chunks = op.insert.match(/.{1,5000}/g) || [];
                    for (const chunk of chunks) {
                        processedOps.push({ ...op, insert: chunk });
                    }
                } else {
                    processedOps.push(op);
                }
            }
            ops = processedOps;

            const BATCH_SIZE = 100;
            let index = 0;

            const loadNextBatch = () => {
                if (index >= ops.length) {
                    finishLoading();
                    return;
                }

                const batch = ops.slice(index, index + BATCH_SIZE);
                quill.updateContents({ ops: batch }, 'api');
                index += BATCH_SIZE;

                setLoadingProgress(Math.min(99, Math.round((index / ops.length) * 100)));
                requestAnimationFrame(loadNextBatch);
            };

            requestAnimationFrame(loadNextBatch);

        } else if (html) {
            // HTML - just paste it (browser will handle it)
            // For very large HTML, we chunk it
            const CHUNK_SIZE = 100000;
            const chunks: string[] = [];

            for (let i = 0; i < html.length; i += CHUNK_SIZE) {
                chunks.push(html.substring(i, i + CHUNK_SIZE));
            }

            let index = 0;

            const loadNextHtmlChunk = () => {
                if (index >= chunks.length) {
                    finishLoading();
                    return;
                }

                quill.clipboard.dangerouslyPasteHTML(quill.getLength(), chunks[index], 'api');
                index++;

                setLoadingProgress(Math.min(99, Math.round((index / chunks.length) * 100)));
                setTimeout(loadNextHtmlChunk, 16);
            };

            requestAnimationFrame(loadNextHtmlChunk);
        } else {
            finishLoading();
        }

        function finishLoading() {
            quill.enable(true);
            contentRef.current = quill.root.innerHTML;
            deltaRef.current = quill.getContents();
            setLoadingProgress(null);
            isFullyLoadedRef.current = true;
            console.log("Loading complete, content length:", contentRef.current.length);
        }

    }, []);

    // Initial Load
    useEffect(() => {
        const abortController = new AbortController();
        let isMounted = true;

        // Reset state
        isFullyLoadedRef.current = false;
        isDirtyRef.current = false;
        contentRef.current = '';
        deltaRef.current = null;
        setLoadingProgress(0);

        const fetchEntry = async () => {
            try {
                setSaveError(false);
                let data: any = null;

                if (urlEntryId) {
                    const res = await fetch(`/api/entry/${urlEntryId}`, { signal: abortController.signal });
                    if (res.ok) data = await res.json();
                } else {
                    const res = await fetch('/api/entry/by-date', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ date: selectedDate, categoryId, userId }),
                        signal: abortController.signal
                    });
                    if (res.ok) data = await res.json();
                }

                if (!isMounted) return;

                if (data) {
                    const loadedId = data.EntryID || data.id;
                    const loadedHtml = data.HtmlContent || data.html || '';
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

                    console.log("Loaded entry:", loadedId, "Delta ops:", loadedDelta?.ops?.length || 0, "HTML length:", loadedHtml.length);

                    if (isMounted) {
                        setEntryId(loadedId);
                    }
                    loadContentSafely(loadedHtml, loadedDelta);

                } else {
                    setSaveError(true);
                    setLoadingProgress(null);
                    isFullyLoadedRef.current = true;
                }

            } catch (err) {
                if ((err as Error).name !== 'AbortError') {
                    console.error("Error fetching entry:", err);
                    setSaveError(true);
                    setLoadingProgress(null);
                }
            }
        };

        fetchEntry();

        return () => {
            isMounted = false;
            abortController.abort();
        };
    }, [categoryId, userId, selectedDate, urlEntryId, loadContentSafely]);


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
                        {loadingProgress !== null ? (
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-400 animate-pulse">
                                Loading {loadingProgress}%
                            </span>
                        ) : (
                            <span className={`text-[10px] uppercase tracking-wider font-semibold flex items-center transition-colors ${saveError ? 'text-red-500' : saving ? 'text-yellow-500' : 'text-green-500'}`}>
                                <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${saveError ? 'bg-red-500' : saving ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
                                {saveError ? 'Error Saving' : saving ? 'Saving' : 'Saved'}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {!urlEntryId && (
                <div className="h-8 border-b border-border-primary flex items-center justify-end px-4 bg-bg-app absolute top-0 right-0 z-50 pointer-events-none">
                    {loadingProgress !== null ? (
                        <span className="text-xs text-blue-400 animate-pulse mr-2">Loading {loadingProgress}%</span>
                    ) : (
                        <span className={`text-xs flex items-center transition-colors ${saveError ? 'text-red-500' : saving ? 'text-yellow-500' : 'text-green-500'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saveError ? 'bg-red-500' : saving ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
                            {saveError ? 'Error' : saving ? 'Saving...' : 'Saved'}
                        </span>
                    )}
                </div>
            )}

            <div className="flex-1 overflow-hidden relative flex flex-col min-h-0">
                {loadingProgress !== null && loadingProgress < 100 && (
                    <div className="absolute inset-0 bg-bg-app/80 z-20 flex items-center justify-center flex-col gap-4 backdrop-blur-sm">
                        <div className="text-lg font-bold text-blue-400 animate-pulse">
                            Loading Large Note ({loadingProgress}%)
                        </div>
                        <div className="w-64 h-2 bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${loadingProgress}%` }}></div>
                        </div>
                        <p className="text-xs text-text-secondary">Please wait...</p>
                    </div>
                )}

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
