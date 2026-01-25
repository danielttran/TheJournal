"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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

    // Register Pixel-based Font Size
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
    const [saveError, setSaveError] = useState(false);

    // Refs for Data Safety (The "Truth" outside React render cycle)
    const contentRef = useRef('');
    const entryIdRef = useRef<number | null>(null);
    const isDirtyRef = useRef(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null); // For debounce

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
            setSaveError(false);
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
            console.error("Save failed", err);
            // Retry with exponential backoff (max 3 retries)
            if (retryCount < 3) {
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, retryCount)));
                return performSave(id, content, isAutoSave, retryCount + 1);
            }
            setSaveError(true);
            return false;
        } finally {
            if (isAutoSave) setSaving(false);
        }
    };

    // Text Change Handler (Optimized: Uncontrolled Mode)
    // We avoid setValue() here to prevent React render loops on large docs
    const handleChange = (content: string) => {
        if (contentRef.current !== content) {
            contentRef.current = content;
            if (!isDirtyRef.current) {
                isDirtyRef.current = true;
                setSaveError(false); // Clear error on new changes
            }

            // Custom Debounce Logic
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = setTimeout(() => {
                if (entryIdRef.current && isDirtyRef.current) {
                    performSave(entryIdRef.current, contentRef.current, true);
                }
            }, 1000);
        }
    };

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

    // beforeunload Warning
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
            // Clear any pending debounce save
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

            const idToSave = entryIdRef.current;
            const contentToSave = contentRef.current;
            const wasDirty = isDirtyRef.current;

            if (wasDirty && idToSave && contentToSave && contentToSave.trim() !== '' && contentToSave !== '<p><br></p>') {
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
                setSaveError(false);
                if (urlEntryId) {
                    const res = await fetch(`/api/entry/${urlEntryId}`, { signal: abortController.signal });
                    if (res.ok) {
                        const data = await res.json();
                        loadedId = data.EntryID;
                        loadedContent = data.HtmlContent || '';
                        if (isMounted) setEntryTitle(data.Title || 'Untitled Page');
                    } else {
                        console.error("Failed to load entry:", res.status);
                        setSaveError(true);
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
                    } else {
                        console.error("Failed to load daily entry:", res.status);
                        setSaveError(true);
                    }
                }
            } catch (err) {
                if ((err as Error).name !== 'AbortError') {
                    console.error("Error fetching entry:", err);
                    setSaveError(true);
                }
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

    const [defaultFontSize, setDefaultFontSize] = useState(14);

    // Load Settings (Font Size)
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

    // Custom Image Handler for file uploads
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
                    setSaving(true); // Visual feedback
                    const res = await fetch('/api/upload', {
                        method: 'POST',
                        body: formData
                    });
                    const data = await res.json();

                    if (data.url) {
                        const quill = (document.querySelector('.ql-editor') as any)?.__quill;
                        // Note: accessing quill instance via DOM is hakcy. 
                        // Better: create a ref for ReactQuill and access .getEditor()
                        // But I don't have the ref wired up easily in this structure without refactoring render.
                        // Actually ReactQuill component exposes ref.
                        // Let's assume standard behavior: the 'this' context of the handler in pure JS Quill is the toolbar/module.
                        // But in React wrapper, it's tricky.

                        // ALTERNATIVE: Use the ref I already have? I don't have a Quill ref.
                        // I will add a ref `quillRef`.
                    }
                } catch (e) {
                    console.error('Image upload failed', e);
                } finally {
                    setSaving(false);
                }
            }
        };
    }, []);

    const quillRef = useRef<any>(null);

    // Toolbar Modules
    // Toolbar Modules
    const modules = useMemo(() => ({
        // Syntax highlighting disabled to prevent lag on large documents
        // syntax: { highlight: (text: string) => hljs.highlightAuto(text).value },
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
                image: () => {
                    // Custom handler access
                    // We need to trigger the file input
                    const input = document.createElement('input');
                    input.setAttribute('type', 'file');
                    input.setAttribute('accept', 'image/*');
                    input.click();

                    input.onchange = async () => {
                        const file = input.files?.[0];
                        if (file) {
                            const formData = new FormData();
                            formData.append('file', file);

                            // Optimistic UI or Loading state?
                            // Just upload
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



    // CSS for Font Size Picker Labels
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
                
                /* Layout for Scrolling & Stability */
                .ql-container.ql-snow { 
                    font-size: ${defaultFontSize}px !important; 
                    border: none !important;
                    display: flex !important;
                    flex-direction: column;
                    flex: 1;
                    min-height: 0;  /* Crucial for proper Flex behavior */
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
                
                /* Custom Font Size Dropdown Labels */
                ${fontSizeCss}
                
                /* Default Label (Normal/False) should match setting */
                .ql-snow .ql-picker.ql-size .ql-picker-label:not([data-value])::before,
                .ql-snow .ql-picker.ql-size .ql-picker-item:not([data-value])::before {
                    content: '${defaultFontSize}px';
                }
                
                /* Fix dropdown width - slightly wider for "Normal" fallback if needed, but 60px is usually enough */
                .ql-snow .ql-picker.ql-size { width: 70px; }
                 /* Ensure toolbar doesn't shrink */
                .ql-toolbar { flex-shrink: 0; }
            `}</style>

            {/* Breadcrumb Header - replacing the old fixed title bar */}
            {urlEntryId && (
                <div className="h-10 border-b border-border-primary flex items-center justify-between px-4 bg-bg-sidebar transition-colors duration-200">
                    <div className="flex-1 overflow-hidden">
                        <Breadcrumbs entryId={urlEntryId} categoryId={categoryId} />
                    </div>
                    <div className="flex items-center ml-4 flex-shrink-0">
                        <span className={`text-[10px] uppercase tracking-wider font-semibold flex items-center transition-colors ${saveError ? 'text-red-500' : saving ? 'text-yellow-500' : 'text-green-500'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${saveError ? 'bg-red-500' : saving ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
                            {saveError ? 'Error Saving' : saving ? 'Saving' : 'Saved'}
                        </span>
                    </div>
                </div>
            )}

            {/* Floating save indicator for journal mode */}
            {!urlEntryId && (
                <div className="h-8 border-b border-border-primary flex items-center justify-end px-4 bg-bg-app absolute top-0 right-0 z-50 pointer-events-none">
                    <span className={`text-xs flex items-center transition-colors ${saveError ? 'text-red-500' : saving ? 'text-yellow-500' : 'text-green-500'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full mr-1 ${saveError ? 'bg-red-500' : saving ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
                        {saveError ? 'Error' : saving ? 'Saving...' : 'Saved'}
                    </span>
                </div>
            )}

            <div className="flex-1 overflow-hidden relative flex flex-col min-h-0">
                <ReactQuill
                    ref={quillRef}
                    key={entryId || 'loading'}
                    theme="snow"
                    defaultValue={value}
                    onChange={handleChange}
                    modules={modules}
                    className="flex-1 flex flex-col bg-transparent border-none min-h-0"
                    placeholder="Start writing..."
                />
            </div>
        </div>
    );
}
