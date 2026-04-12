import { type Editor } from '@tiptap/react';
import {
    Bold, Italic, Strikethrough, Code, Code2,
    List, ListOrdered, CheckSquare,
    Quote, Highlighter,
    Image as ImageIcon, Link as LinkIcon, RemoveFormatting,
    Undo, Redo, Minus, Upload, Table as TableIcon, Sparkles
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function TipTapToolbar({ editor }: { editor: Editor | null }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [showTableMenu, setShowTableMenu] = useState(false);
    const tableMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showTableMenu) return;
        const handler = (e: MouseEvent) => {
            if (tableMenuRef.current && !tableMenuRef.current.contains(e.target as Node)) {
                setShowTableMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showTableMenu]);

    const isSafeUrl = (url: string): boolean => {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' || parsed.protocol === 'http:';
        } catch {
            // Allow root-relative paths (/path/to/img) but not protocol-relative (//evil.com)
            return (url.startsWith('/') && !url.startsWith('//')) || !url.includes(':');
        }
    };

    const addImageFromUrl = useCallback(() => {
        if (!editor) return;

        const url = (window.prompt('Image URL:') || '').trim();
        if (!url) return;
        if (!isSafeUrl(url)) {
            window.alert('Only http:// and https:// URLs are allowed.');
            return;
        }
        editor.chain().focus().setImage({ src: url, width: '100%' } as any).run();
    }, [editor]);

    const uploadImage = useCallback(async (file: File) => {
        if (!editor) return;

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (!res.ok || !data.url) {
                throw new Error(data.error || 'Upload failed');
            }

            editor.chain().focus().setImage({ src: data.url, width: '100%' } as any).run();
        } catch (error) {
            console.error('Image upload failed', error);
            window.alert('Image upload failed. Please try again.');
        } finally {
            setIsUploading(false);
        }
    }, [editor]);

    const setLink = useCallback(() => {
        if (!editor) return;

        const previousUrl = editor.getAttributes('link').href;
        const url = window.prompt('URL:', previousUrl);

        if (url === null) return;
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }

        const trimmed = url.trim();
        if (!isSafeUrl(trimmed)) {
            window.alert('Only http:// and https:// URLs are allowed.');
            return;
        }

        editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
    }, [editor]);

    useEffect(() => {
        const handleExternalUploadTrigger = () => {
            fileInputRef.current?.click();
        };

        window.addEventListener('trigger-image-upload', handleExternalUploadTrigger);
        return () => window.removeEventListener('trigger-image-upload', handleExternalUploadTrigger);
    }, []);

    if (!editor) {
        return null;
    }

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await uploadImage(file);
        e.target.value = '';
    };

    const selectedImageSrc = editor.isActive('image')
        ? (editor.getAttributes('image').src as string | undefined) ?? ''
        : '';
    // Only allow crop for images we uploaded (they live at /api/attachment/)
    const isAttachedImage = selectedImageSrc.startsWith('/api/attachment/');

    const rawWidth = editor.isActive('image')
        ? String(editor.getAttributes('image').width ?? '100%')
        : '100%';
    const imageWidthNum = Math.min(100, Math.max(10, parseInt(rawWidth.replace('%', ''), 10) || 100));

    const handleResizeImage = (pct: number) => {
        if (!editor.isActive('image')) return;
        editor.chain().focus().updateAttributes('image', { width: `${pct}%` }).run();
    };

    const removeSelectedImage = () => {
        if (!editor.isActive('image')) return;
        editor.chain().focus().deleteSelection().run();
    };

    return (
        <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border-primary bg-bg-sidebar">
            <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handleFileChange}
            />

            <button
                onClick={() => editor.chain().focus().toggleBold().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('bold') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Bold (Ctrl+B)"
            >
                <Bold className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleItalic().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('italic') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Italic (Ctrl+I)"
            >
                <Italic className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleStrike().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('strike') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Strikethrough"
            >
                <Strikethrough className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-border-primary mx-1" />

            <button
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                className={`p-1.5 rounded hover:bg-bg-hover font-bold text-xs ${editor.isActive('heading', { level: 1 }) ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Heading 1"
            >
                H1
            </button>
            <button
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                className={`p-1.5 rounded hover:bg-bg-hover font-bold text-xs ${editor.isActive('heading', { level: 2 }) ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Heading 2"
            >
                H2
            </button>
            <button
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                className={`p-1.5 rounded hover:bg-bg-hover font-bold text-xs ${editor.isActive('heading', { level: 3 }) ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Heading 3"
            >
                H3
            </button>

            <div className="w-px h-4 bg-border-primary mx-1" />

            <button
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('bulletList') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Bullet List"
            >
                <List className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('orderedList') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Numbered List"
            >
                <ListOrdered className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleTaskList().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('taskList') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Checklist"
            >
                <CheckSquare className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-border-primary mx-1" />

            <button
                onClick={() => editor.chain().focus().toggleCode().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('code') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Inline Code"
            >
                <Code className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('codeBlock') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Code Block"
            >
                <Code2 className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('blockquote') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Quote"
            >
                <Quote className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted"
                title="Divider"
            >
                <Minus className="w-4 h-4" />
            </button>

            {/* Table button + context menu */}
            <div className="relative" ref={tableMenuRef}>
                <button
                    onClick={() => setShowTableMenu(v => !v)}
                    className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('table') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                    title="Table"
                >
                    <TableIcon className="w-4 h-4" />
                </button>
                {showTableMenu && (
                    <div className="absolute top-full left-0 mt-1 z-[300] bg-bg-card border border-border-primary rounded-lg shadow-xl py-1 min-w-[170px]">
                        <button
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-text-primary"
                            onClick={() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); setShowTableMenu(false); }}
                        >
                            Insert 3×3 table
                        </button>
                        {editor.isActive('table') && (
                            <>
                                <div className="mx-2 my-1 border-t border-border-primary" />
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-text-primary" onClick={() => { editor.chain().focus().addRowAfter().run(); setShowTableMenu(false); }}>Add row below</button>
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-text-primary" onClick={() => { editor.chain().focus().addColumnAfter().run(); setShowTableMenu(false); }}>Add column right</button>
                                <div className="mx-2 my-1 border-t border-border-primary" />
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-red-400" onClick={() => { editor.chain().focus().deleteRow().run(); setShowTableMenu(false); }}>Delete row</button>
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-red-400" onClick={() => { editor.chain().focus().deleteColumn().run(); setShowTableMenu(false); }}>Delete column</button>
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-red-400" onClick={() => { editor.chain().focus().deleteTable().run(); setShowTableMenu(false); }}>Delete table</button>
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className="w-px h-4 bg-border-primary mx-1" />

            <button
                onClick={() => editor.chain().focus().toggleHighlight().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('highlight') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Highlight"
            >
                <Highlighter className="w-4 h-4" />
            </button>

            <button
                onClick={addImageFromUrl}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted"
                title="Insert Image by URL"
            >
                <ImageIcon className="w-4 h-4" />
            </button>
            <button
                onClick={handleUploadClick}
                disabled={isUploading}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted disabled:opacity-50"
                title="Upload Image"
            >
                <Upload className="w-4 h-4" />
            </button>
            <button
                onClick={setLink}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('link') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Link"
            >
                <LinkIcon className="w-4 h-4" />
            </button>

            {editor.isActive('image') && (
                <>
                    <div className="w-px h-4 bg-border-primary mx-1" />
                    <span className="text-[11px] text-text-muted select-none">W:</span>
                    <input
                        type="range"
                        min={10}
                        max={100}
                        step={1}
                        value={imageWidthNum}
                        onChange={e => handleResizeImage(Number(e.target.value))}
                        className="w-24 h-1.5 accent-[color:var(--color-accent-primary)] cursor-pointer"
                        title={`Image width: ${imageWidthNum}%`}
                    />
                    <span className="text-[11px] text-text-muted tabular-nums w-7 text-right select-none">
                        {imageWidthNum}%
                    </span>
                    {isAttachedImage && (
                        <button
                            onClick={() => window.dispatchEvent(new Event('trigger-crop-image'))}
                            className="text-xs px-2 py-1 rounded text-text-muted hover:bg-bg-hover"
                            title="Crop image"
                        >
                            Crop
                        </button>
                    )}
                    <button
                        onClick={removeSelectedImage}
                        className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-500/10"
                        title="Remove selected image"
                    >
                        Remove
                    </button>
                </>
            )}

            <div className="flex-1" />

            <button
                onClick={() => window.dispatchEvent(new Event('trigger-prompts'))}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted"
                title="Writing Prompts (Ctrl+Shift+P)"
            >
                <Sparkles className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-border-primary mx-1" />

            <button
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted disabled:opacity-30"
                title="Undo"
            >
                <Undo className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted disabled:opacity-30"
                title="Redo"
            >
                <Redo className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted"
                title="Clear Formatting"
            >
                <RemoveFormatting className="w-4 h-4" />
            </button>
        </div>
    );
}
