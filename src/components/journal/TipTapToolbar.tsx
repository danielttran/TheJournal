import { type Editor } from '@tiptap/react';
import {
    Bold, Italic, Strikethrough, Code, Code2,
    List, ListOrdered, CheckSquare,
    Quote, Highlighter,
    Image as ImageIcon, Link as LinkIcon, RemoveFormatting,
    Undo, Redo, Minus, Upload, Table as TableIcon, Sparkles, ChevronDown,
    CalendarClock, Bookmark as BookmarkIcon, Paintbrush, PenTool, Network, GitMerge,
    AlignLeft, AlignCenter, AlignRight, AlignJustify,
    Subscript as SubscriptIcon, Superscript as SuperscriptIcon,
    Indent, Outdent, Omega, Paperclip
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TheJournalAPI } from '@/lib/pluginApi';
import { SPECIAL_CHAR_GROUPS } from '@/lib/specialChars';
import { LINE_HEIGHTS } from '@/lib/paragraphStyle';
import { normalizeLinkUrl } from '@/lib/linkUrl';
import { loadToolbarConfig, isGroupVisible, TOOLBAR_CONFIG_EVENT } from '@/lib/toolbarConfig';
import PromptModal from './PromptModal';
import { requestPrompt } from '@/lib/promptService';

export default function TipTapToolbar({ editor }: { editor: Editor | null }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const attachInputRef = useRef<HTMLInputElement>(null);
    const [pluginToolbarButtons, setPluginToolbarButtons] = useState(() => [...TheJournalAPI.registeredToolbarButtons]);
    const [isUploading, setIsUploading] = useState(false);
    const [lastTextColor, setLastTextColor] = useState('#ffffff');
    const [lastHighlightColor, setLastHighlightColor] = useState('#ffff00');
    const [capturedFormat, setCapturedFormat] = useState<{
        marks: string[];
        textStyle: Record<string, unknown>;
        highlight: Record<string, unknown> | null;
    } | null>(null);
    const [showTableMenu, setShowTableMenu] = useState(false);
    const [tableHover, setTableHover] = useState({ r: 0, c: 0 });
    const [gridSize, setGridSize] = useState({ r: 10, c: 10 });
    const tableMenuRef = useRef<HTMLDivElement>(null);
    const [showSpecialChars, setShowSpecialChars] = useState(false);
    const specialCharsRef = useRef<HTMLDivElement>(null);
    const [showBookmarkJump, setShowBookmarkJump] = useState(false);
    const bookmarkJumpRef = useRef<HTMLDivElement>(null);
    // Styled in-app hyperlink dialog (J8 "Insert Hyperlink" parity) — replaces
    // the old window.prompt so we can offer "open in new tab" + inline errors.
    const [linkDialog, setLinkDialog] = useState<{ url: string; newTab: boolean; error: string } | null>(null);
    const linkInputRef = useRef<HTMLInputElement>(null);
    const [showImageUrl, setShowImageUrl] = useState(false);
    // Toolbar customization (J8 "Customize Toolbar"): hidden-group set, kept in
    // sync with the Settings UI via a window event (mirrors font-size-changed).
    const [hiddenGroups, setHiddenGroups] = useState(() => loadToolbarConfig());
    useEffect(() => {
        const refresh = () => setHiddenGroups(loadToolbarConfig());
        window.addEventListener(TOOLBAR_CONFIG_EVENT, refresh);
        return () => window.removeEventListener(TOOLBAR_CONFIG_EVENT, refresh);
    }, []);
    const showGroup = useCallback((id: string) => isGroupVisible(hiddenGroups, id), [hiddenGroups]);

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

    useEffect(() => {
        if (!showSpecialChars && !showBookmarkJump) return;
        const handler = (e: MouseEvent) => {
            if (specialCharsRef.current && !specialCharsRef.current.contains(e.target as Node)) setShowSpecialChars(false);
            if (bookmarkJumpRef.current && !bookmarkJumpRef.current.contains(e.target as Node)) setShowBookmarkJump(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showSpecialChars, showBookmarkJump]);

    useEffect(() => TheJournalAPI.subscribeToolbarButtons(setPluginToolbarButtons), []);

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
        setShowImageUrl(true);
    }, [editor]);

    const insertImageUrl = useCallback((raw: string): string | null => {
        if (!editor) return null;
        const url = raw.trim();
        if (!isSafeUrl(url)) return 'Only http:// and https:// URLs are allowed.';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ResizableImage adds `width` but its type isn't merged into TipTap's command map
        editor.chain().focus().setImage({ src: url, width: '100%' } as any).run();
        return null;
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

            if (data.kind === 'video') {
                editor.chain().focus().insertContent({
                    type: 'videoBlock',
                    attrs: { src: data.url, mimeType: data.mimeType, width: '100%' },
                }).run();
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ResizableImage adds `width` but its type isn't merged into TipTap's command map
                editor.chain().focus().setImage({ src: data.url, width: '100%' } as any).run();
            }
        } catch (error) {
            console.error('Media upload failed', error);
            window.alert('Media upload failed. Please try again.');
        } finally {
            setIsUploading(false);
        }
    }, [editor]);

    const uploadFileAttachment = useCallback(async (file: File) => {
        if (!editor) return;
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/upload/file', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
            editor.chain().focus().setFileAttachment({
                href: data.url, filename: data.filename, size: data.size,
            }).run();
        } catch (error) {
            console.error('File attachment upload failed', error);
            window.alert('File attachment upload failed. Please try again.');
        } finally {
            setIsUploading(false);
        }
    }, [editor]);

    const setLink = useCallback(() => {
        if (!editor) return;
        const attrs = editor.getAttributes('link');
        setLinkDialog({
            url: (attrs.href as string | undefined) ?? '',
            newTab: attrs.target === '_blank',
            error: '',
        });
    }, [editor]);

    const applyLink = useCallback((url: string, newTab: boolean) => {
        if (!editor) return;
        if (url.trim() === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            setLinkDialog(null);
            return;
        }
        const res = normalizeLinkUrl(url);
        if (!res.ok) {
            setLinkDialog(d => (d ? { ...d, error: res.reason } : d));
            return;
        }
        const ok = editor.chain().focus().extendMarkRange('link')
            .setLink({ href: res.href, target: newTab ? '_blank' : null })
            .run();
        if (!ok) {
            setLinkDialog(d => (d ? { ...d, error: 'This link could not be applied.' } : d));
            return;
        }
        setLinkDialog(null);
    }, [editor]);

    const insertDateTime = useCallback(() => {
        if (!editor) return;
        const now = new Date();
        const stamp = `${now.toLocaleDateString(undefined, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        })} ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
        editor.chain().focus().insertContent(stamp).run();
    }, [editor]);

    const addBookmark = useCallback(async () => {
        if (!editor) return;
        const name = (await requestPrompt({ title: 'Insert Bookmark', message: 'Bookmark name (used as a link target).', placeholder: 'e.g. chapter-2', confirmLabel: 'Insert' }) || '').trim();
        if (!name) return;
        editor.chain().focus().setBookmark(name).run();
    }, [editor]);

    const linkToBookmark = useCallback(async () => {
        if (!editor) return;
        const name = (await requestPrompt({ title: 'Link to Bookmark', message: 'Bookmark name to link the selection to.', confirmLabel: 'Link' }) || '').trim();
        if (!name) return;
        editor.chain().focus().extendMarkRange('link')
            .setLink({ href: `#${name}` }).run();
    }, [editor]);

    const insertSpecialChar = useCallback((ch: string) => {
        if (!editor) return;
        editor.chain().focus().insertContent(ch).run();
    }, [editor]);

    // Collect every named bookmark anchor present in the document so the user
    // can jump to one (David RM "Bookmark…" navigation).
    const collectBookmarks = useCallback((): string[] => {
        if (!editor) return [];
        const names: string[] = [];
        editor.state.doc.descendants((node) => {
            if (node.type.name === 'bookmark') {
                const n = String(node.attrs.name ?? '').trim();
                if (n) names.push(n);
            }
        });
        return [...new Set(names)];
    }, [editor]);

    const jumpToBookmark = useCallback((name: string) => {
        if (!editor) return;
        let target = -1;
        editor.state.doc.descendants((node, pos) => {
            if (target === -1 && node.type.name === 'bookmark' && String(node.attrs.name ?? '').trim() === name) {
                target = pos;
            }
        });
        if (target >= 0) {
            editor.chain().focus().setTextSelection(target).scrollIntoView().run();
        }
    }, [editor]);

    // Paste Special — insert clipboard text with all formatting stripped.
    const pasteSpecial = useCallback(async () => {
        if (!editor) return;
        try {
            const text = await navigator.clipboard.readText();
            if (text) editor.chain().focus().insertContent(text).run();
        } catch {
            window.alert('Plain-text paste needs clipboard permission. Use Ctrl+Shift+V again after allowing access, or paste normally then clear formatting.');
        }
    }, [editor]);

    // Indent / outdent: inside a list, sink/lift the list item; otherwise
    // apply block-level paragraph indentation (ParagraphStyle extension).
    const indent = useCallback(() => {
        if (!editor) return;
        const chain = editor.chain().focus();
        if (editor.isActive('taskItem')) chain.sinkListItem('taskItem').run();
        else if (editor.isActive('listItem')) chain.sinkListItem('listItem').run();
        else chain.indentBlock().run();
    }, [editor]);

    const outdent = useCallback(() => {
        if (!editor) return;
        const chain = editor.chain().focus();
        if (editor.isActive('taskItem')) chain.liftListItem('taskItem').run();
        else if (editor.isActive('listItem')) chain.liftListItem('listItem').run();
        else chain.outdentBlock().run();
    }, [editor]);

    const applyCapturedFormat = useCallback((fmt: NonNullable<typeof capturedFormat>) => {
        if (!editor || editor.state.selection.empty) return;
        const chain = editor.chain().focus();
        chain.unsetAllMarks();
        for (const m of fmt.marks) chain.setMark(m);
        const ts = fmt.textStyle;
        if (ts.color) chain.setColor(ts.color as string);
        if (ts.fontFamily) chain.setFontFamily(ts.fontFamily as string);
        if (ts.fontSize) chain.setFontSize(ts.fontSize as string);
        if (fmt.highlight?.color) {
            chain.setHighlight({ color: fmt.highlight.color as string });
        }
        chain.run();
    }, [editor]);

    // Format painter (sticky): click to arm (captures formatting at the
    // cursor); the next selection in the editor gets the formatting applied,
    // then it disarms. Clicking again while armed cancels.
    const toggleFormatPainter = useCallback(() => {
        if (!editor) return;
        if (capturedFormat) {
            // Armed: if there's already a selection, paint it now; otherwise
            // this click cancels.
            if (!editor.state.selection.empty) applyCapturedFormat(capturedFormat);
            setCapturedFormat(null);
            return;
        }
        const marks: string[] = [];
        for (const m of ['bold', 'italic', 'underline', 'strike', 'code']) {
            if (editor.isActive(m)) marks.push(m);
        }
        setCapturedFormat({
            marks,
            textStyle: editor.getAttributes('textStyle') ?? {},
            highlight: editor.isActive('highlight') ? editor.getAttributes('highlight') : null,
        });
    }, [editor, capturedFormat, applyCapturedFormat]);

    // While armed, paint the next non-empty selection the user makes.
    useEffect(() => {
        if (!editor || !capturedFormat) return;
        const dom = editor.view.dom as HTMLElement;
        const onMouseUp = () => {
            // defer so the selection has settled
            setTimeout(() => {
                if (!editor.state.selection.empty) {
                    applyCapturedFormat(capturedFormat);
                    setCapturedFormat(null);
                }
            }, 0);
        };
        dom.addEventListener('mouseup', onMouseUp);
        return () => dom.removeEventListener('mouseup', onMouseUp);
    }, [editor, capturedFormat, applyCapturedFormat]);

    useEffect(() => {
        const handleExternalUploadTrigger = () => {
            fileInputRef.current?.click();
        };

        window.addEventListener('trigger-image-upload', handleExternalUploadTrigger);
        return () => window.removeEventListener('trigger-image-upload', handleExternalUploadTrigger);
    }, []);

    useEffect(() => {
        if (linkDialog) { linkInputRef.current?.focus(); linkInputRef.current?.select(); }
    }, [linkDialog]);

    // Keyboard-command bridges from CommandDispatcher (Ctrl+K, Ctrl+Shift+V, …).
    useEffect(() => {
        const onLink = () => setLink();
        const onPasteSpecial = () => { void pasteSpecial(); };
        const onBookmark = () => addBookmark();
        const onDateTime = () => insertDateTime();
        const onSpecialChar = () => setShowSpecialChars(v => !v);
        const onAttachment = () => attachInputRef.current?.click();
        const onFormatPainter = () => toggleFormatPainter();
        window.addEventListener('trigger-link', onLink);
        window.addEventListener('trigger-paste-special', onPasteSpecial);
        window.addEventListener('trigger-bookmark', onBookmark);
        window.addEventListener('trigger-datetime', onDateTime);
        window.addEventListener('trigger-special-char', onSpecialChar);
        window.addEventListener('trigger-attachment', onAttachment);
        window.addEventListener('trigger-format-painter', onFormatPainter);
        return () => {
            window.removeEventListener('trigger-link', onLink);
            window.removeEventListener('trigger-paste-special', onPasteSpecial);
            window.removeEventListener('trigger-bookmark', onBookmark);
            window.removeEventListener('trigger-datetime', onDateTime);
            window.removeEventListener('trigger-special-char', onSpecialChar);
            window.removeEventListener('trigger-attachment', onAttachment);
            window.removeEventListener('trigger-format-painter', onFormatPainter);
        };
    }, [setLink, pasteSpecial, addBookmark, insertDateTime, toggleFormatPainter]);

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
    // Drawings are marked with alt="tj-drawing" so they can be re-edited.
    const isDrawing = editor.isActive('image')
        && (editor.getAttributes('image').alt as string | undefined) === 'tj-drawing';

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

    const currentStyle = editor.isActive('heading', { level: 1 }) ? 'h1'
        : editor.isActive('heading', { level: 2 }) ? 'h2'
        : editor.isActive('heading', { level: 3 }) ? 'h3'
        : editor.isActive('blockquote') ? 'blockquote'
        : editor.isActive('codeBlock') ? 'codeBlock'
        : 'paragraph';

    const applyStyle = (val: string) => {
        const chain = editor.chain().focus();
        switch (val) {
            case 'h1': chain.setHeading({ level: 1 }).run(); break;
            case 'h2': chain.setHeading({ level: 2 }).run(); break;
            case 'h3': chain.setHeading({ level: 3 }).run(); break;
            case 'blockquote': chain.setBlockquote().run(); break;
            case 'codeBlock': chain.setCodeBlock().run(); break;
            default: chain.setParagraph().run();
        }
    };

    const bookmarks = collectBookmarks();

    return (
        <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border-primary bg-bg-sidebar">
            <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,video/*"
                onChange={handleFileChange}
            />
            <input
                ref={attachInputRef}
                type="file"
                className="hidden"
                onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) await uploadFileAttachment(f);
                    e.target.value = '';
                }}
            />

            {showGroup('font') && (<>
            <select
                onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                        editor.chain().focus().unsetFontFamily().run();
                    } else {
                        editor.chain().focus().setFontFamily(val).run();
                    }
                }}
                value={editor.getAttributes('textStyle').fontFamily || ''}
                className="p-1 px-1.5 text-xs bg-transparent border border-border-primary rounded hover:bg-bg-hover text-text-primary outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]"
                title="Font Family"
            >
                <option value="">Default Font</option>
                <option value="Inter, sans-serif">Inter</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="'Comic Sans MS', cursive">Comic Sans</option>
                <option value="'Courier New', monospace">Courier New</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="'Times New Roman', serif">Times Roman</option>
                <option value="'Trebuchet MS', sans-serif">Trebuchet</option>
                <option value="Verdana, sans-serif">Verdana</option>
            </select>

            <select
                onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                        editor.chain().focus().unsetFontSize().run();
                    } else {
                        editor.chain().focus().setFontSize(val).run();
                    }
                }}
                value={editor.getAttributes('textStyle').fontSize || ''}
                className="p-1 px-1.5 text-xs bg-transparent border border-border-primary rounded hover:bg-bg-hover text-text-primary outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]"
                title="Font Size"
            >
                <option value="">Size</option>
                <option value="12px">12</option>
                <option value="14px">14</option>
                <option value="16px">16</option>
                <option value="18px">18</option>
                <option value="20px">20</option>
                <option value="24px">24</option>
                <option value="28px">28</option>
                <option value="32px">32</option>
                <option value="36px">36</option>
            </select>

            <div className="flex flex-row items-stretch border border-transparent hover:border-border-primary rounded bg-transparent group ml-1">
                <button
                    onClick={() => editor.chain().focus().setColor(lastTextColor).run()}
                    className="flex flex-col items-center justify-center p-1 w-7 h-7 rounded-l hover:bg-bg-hover"
                    title="Text Color"
                >
                    <span className="font-bold font-serif text-[13px] leading-none text-text-muted mt-[1px] pointer-events-none">A</span>
                    <div className="w-[14px] h-[3px] mt-[1px] rounded-sm pointer-events-none border border-black/20" style={{ backgroundColor: lastTextColor }} />
                </button>
                <div className="relative flex items-center justify-center px-0.5 rounded-r hover:bg-bg-hover cursor-pointer" title="Choose Text Color">
                    <input
                        type="color"
                        onChange={(e) => {
                            setLastTextColor(e.target.value);
                            editor.chain().focus().setColor(e.target.value).run();
                        }}
                        value={lastTextColor}
                        className="w-4 h-full p-0 border-0 rounded cursor-pointer opacity-0 absolute inset-0 z-10"
                    />
                    <ChevronDown className="w-3 h-3 text-text-muted pointer-events-none" />
                </div>
            </div>

            <div className="flex flex-row items-stretch border border-transparent hover:border-border-primary rounded bg-transparent group">
                <button
                    onClick={() => editor.chain().focus().toggleHighlight({ color: lastHighlightColor }).run()}
                    className="flex flex-col items-center justify-center p-1 w-7 h-7 rounded-l hover:bg-bg-hover"
                    title="Text Background Color"
                >
                    <Highlighter className="w-3.5 h-3.5 text-text-muted pointer-events-none" />
                    <div className="w-[14px] h-[3px] mt-[1px] rounded-sm pointer-events-none border border-black/20" style={{ backgroundColor: lastHighlightColor }} />
                </button>
                <div className="relative flex items-center justify-center px-0.5 rounded-r hover:bg-bg-hover cursor-pointer" title="Choose Background Color">
                    <input
                        type="color"
                        onChange={(e) => {
                            setLastHighlightColor(e.target.value);
                            editor.chain().focus().setHighlight({ color: e.target.value }).run();
                        }}
                        value={lastHighlightColor}
                        className="w-4 h-full p-0 border-0 rounded cursor-pointer opacity-0 absolute inset-0 z-10"
                    />
                    <ChevronDown className="w-3 h-3 text-text-muted pointer-events-none" />
                </div>
            </div>
            </>)}

            {showGroup('marks') && (<>
            <div className="w-px h-4 bg-border-primary mx-1" />

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
            <button
                onClick={() => editor.chain().focus().toggleSubscript().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('subscript') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Subscript"
            >
                <SubscriptIcon className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleSuperscript().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('superscript') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Superscript"
            >
                <SuperscriptIcon className="w-4 h-4" />
            </button>
            </>)}

            {showGroup('style') && (<>
            <div className="w-px h-4 bg-border-primary mx-1" />

            <select
                value={currentStyle}
                onChange={(e) => applyStyle(e.target.value)}
                className="p-1 px-1.5 text-xs bg-transparent border border-border-primary rounded hover:bg-bg-hover text-text-primary outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]"
                title="Paragraph style"
            >
                <option value="paragraph">Normal</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="blockquote">Quote</option>
                <option value="codeBlock">Code block</option>
            </select>
            </>)}

            {showGroup('lists') && (<>
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
            <button onClick={outdent} className="p-1.5 rounded hover:bg-bg-hover text-text-muted" title="Decrease indent">
                <Outdent className="w-4 h-4" />
            </button>
            <button onClick={indent} className="p-1.5 rounded hover:bg-bg-hover text-text-muted" title="Increase indent">
                <Indent className="w-4 h-4" />
            </button>
            </>)}

            {showGroup('align') && (<>
            <div className="w-px h-4 bg-border-primary mx-1" />

            <button
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive({ textAlign: 'left' }) ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Align left"
            >
                <AlignLeft className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive({ textAlign: 'center' }) ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Align center"
            >
                <AlignCenter className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive({ textAlign: 'right' }) ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Align right"
            >
                <AlignRight className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive({ textAlign: 'justify' }) ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Justify"
            >
                <AlignJustify className="w-4 h-4" />
            </button>
            <select
                onChange={(e) => {
                    const v = e.target.value;
                    if (v) editor.chain().focus().setLineHeight(v).run();
                    else editor.chain().focus().unsetLineHeight().run();
                }}
                value={editor.getAttributes('paragraph').lineHeight || editor.getAttributes('heading').lineHeight || ''}
                className="p-1 px-1.5 text-xs bg-transparent border border-border-primary rounded hover:bg-bg-hover text-text-primary outline-none focus:ring-1 focus:ring-[color:var(--color-accent-primary)]"
                title="Line spacing"
            >
                <option value="">Spacing</option>
                {LINE_HEIGHTS.map(h => <option key={h} value={h}>{h}&times;</option>)}
            </select>
            </>)}

            {showGroup('blocks') && (<>
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
                    <div className="absolute top-full left-0 mt-1 z-[300] bg-bg-card border border-border-primary rounded-lg shadow-xl py-1 min-w-[170px] w-max">
                        {editor.isActive('table') ? (
                            <>
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-text-primary" onClick={() => { editor.chain().focus().addRowAfter().run(); setShowTableMenu(false); }}>Add row below</button>
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-text-primary" onClick={() => { editor.chain().focus().addColumnAfter().run(); setShowTableMenu(false); }}>Add column right</button>
                                <div className="mx-2 my-1 border-t border-border-primary" />
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-red-400" onClick={() => { editor.chain().focus().deleteRow().run(); setShowTableMenu(false); }}>Delete row</button>
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-red-400" onClick={() => { editor.chain().focus().deleteColumn().run(); setShowTableMenu(false); }}>Delete column</button>
                                <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-red-400" onClick={() => { editor.chain().focus().deleteTable().run(); setShowTableMenu(false); }}>Delete table</button>
                            </>
                        ) : (
                            <div className="px-3 py-2 flex flex-col items-center">
                                <div className="text-xs text-text-muted mb-2 font-medium">
                                    {tableHover.r > 0 ? `${tableHover.r} × ${tableHover.c} Table` : 'Insert Table'}
                                </div>
                                <div 
                                    className="grid m-1" 
                                    style={{ gap: '4px', gridTemplateColumns: `repeat(${gridSize.c}, 14px)` }}
                                    onMouseLeave={() => {
                                        setTableHover({ r: 0, c: 0 });
                                        setGridSize({ r: 10, c: 10 });
                                    }}
                                >
                                    {Array.from({ length: gridSize.r }).map((_, rItem) => (
                                        Array.from({ length: gridSize.c }).map((_, cItem) => {
                                            const r = rItem + 1;
                                            const c = cItem + 1;
                                            const isHovered = tableHover.r >= r && tableHover.c >= c;
                                            return (
                                                <div
                                                    key={`${r}-${c}`}
                                                    className={`w-3.5 h-3.5 border rounded-[2px] ${isHovered ? 'bg-[color:var(--color-accent-primary)] border-[color:var(--color-accent-primary)] opacity-80' : 'bg-transparent border-border-primary hover:border-[color:var(--color-accent-primary)]'} cursor-pointer`}
                                                    onMouseEnter={() => {
                                                        setTableHover({ r, c });
                                                        if (r === gridSize.r && gridSize.r < 20) setGridSize(prev => ({ ...prev, r: prev.r + 1 }));
                                                        if (c === gridSize.c && gridSize.c < 20) setGridSize(prev => ({ ...prev, c: prev.c + 1 }));
                                                    }}
                                                    onClick={() => {
                                                        editor.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: false }).run();
                                                        setShowTableMenu(false);
                                                        setTableHover({ r: 0, c: 0 });
                                                        setGridSize({ r: 10, c: 10 });
                                                    }}
                                                />
                                            );
                                        })
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            </>)}

            {showGroup('insert') && (<>
            <div className="w-px h-4 bg-border-primary mx-1" />

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
                onClick={() => window.dispatchEvent(new Event('trigger-insert-drawing'))}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted"
                title="Insert drawing"
            >
                <PenTool className="w-4 h-4" />
            </button>
            <button
                onClick={setLink}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('link') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Link"
            >
                <LinkIcon className="w-4 h-4" />
            </button>
            <button
                onClick={() => attachInputRef.current?.click()}
                disabled={isUploading}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted disabled:opacity-50"
                title="Attach file"
            >
                <Paperclip className="w-4 h-4" />
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
                    {isDrawing && (
                        <button
                            onClick={() => window.dispatchEvent(new Event('trigger-edit-drawing'))}
                            className="text-xs px-2 py-1 rounded text-text-muted hover:bg-bg-hover"
                            title="Edit drawing"
                        >
                            Edit drawing
                        </button>
                    )}
                    {isAttachedImage && !isDrawing && (
                        <button
                            onClick={() => window.dispatchEvent(new Event('trigger-crop-image'))}
                            className="text-xs px-2 py-1 rounded text-text-muted hover:bg-bg-hover"
                            title="Crop image"
                        >
                            Crop
                        </button>
                    )}
                    <button
                        onClick={async () => {
                            if (!editor.isActive('image')) return;
                            const current = (editor.getAttributes('image').alt as string | undefined) ?? '';
                            const next = await requestPrompt({ title: 'Image Description', message: 'Alt text — indexed by search and read by screen readers.', initialValue: current, allowEmpty: true, confirmLabel: 'Save' });
                            if (next === null) return;
                            editor.chain().focus().updateAttributes('image', { alt: next.trim() }).run();
                        }}
                        className="text-xs px-2 py-1 rounded text-text-muted hover:bg-bg-hover"
                        title="Edit alt text (description for screen readers and search)"
                    >
                        Alt
                    </button>
                    <button
                        onClick={removeSelectedImage}
                        className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-500/10"
                        title="Remove selected image"
                    >
                        Remove
                    </button>
                </>
            )}
            </>)}

            {showGroup('tools') && (<>
            <div className="w-px h-4 bg-border-primary mx-1" />

            <button
                onClick={insertDateTime}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted"
                title="Insert date & time"
            >
                <CalendarClock className="w-4 h-4" />
            </button>
            <button
                onClick={addBookmark}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted"
                title="Insert bookmark anchor"
            >
                <BookmarkIcon className="w-4 h-4" />
            </button>
            <button
                onClick={linkToBookmark}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted text-xs font-semibold"
                title="Link to a bookmark"
            >
                #
            </button>
            <div className="relative" ref={bookmarkJumpRef}>
                <button
                    onClick={() => setShowBookmarkJump(v => !v)}
                    className="p-1.5 rounded hover:bg-bg-hover text-text-muted flex items-center"
                    title="Go to bookmark"
                >
                    <BookmarkIcon className="w-4 h-4" />
                    <ChevronDown className="w-3 h-3" />
                </button>
                {showBookmarkJump && (
                    <div className="absolute top-full left-0 mt-1 z-[300] bg-bg-card border border-border-primary rounded-lg shadow-xl py-1 min-w-[180px] max-h-72 overflow-y-auto">
                        {bookmarks.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-text-muted">No bookmarks in this entry</div>
                        ) : bookmarks.map(name => (
                            <button
                                key={name}
                                onClick={() => { jumpToBookmark(name); setShowBookmarkJump(false); }}
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover text-text-primary truncate"
                            >
                                {name}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="relative" ref={specialCharsRef}>
                <button
                    onClick={() => setShowSpecialChars(v => !v)}
                    className="p-1.5 rounded hover:bg-bg-hover text-text-muted"
                    title="Insert special character"
                >
                    <Omega className="w-4 h-4" />
                </button>
                {showSpecialChars && (
                    <div className="absolute top-full left-0 mt-1 z-[300] bg-bg-card border border-border-primary rounded-lg shadow-xl p-2 w-[260px] max-h-72 overflow-y-auto">
                        {SPECIAL_CHAR_GROUPS.map(g => (
                            <div key={g.label} className="mb-2">
                                <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1 px-0.5">{g.label}</div>
                                <div className="grid grid-cols-8 gap-0.5">
                                    {g.chars.map(ch => (
                                        <button
                                            key={ch}
                                            onClick={() => { insertSpecialChar(ch); setShowSpecialChars(false); }}
                                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-hover text-text-primary text-base"
                                            title={ch}
                                        >
                                            {ch}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <button
                onClick={toggleFormatPainter}
                className={`p-1.5 rounded hover:bg-bg-hover ${capturedFormat ? 'bg-bg-active text-text-primary ring-1 ring-[color:var(--color-accent-primary)]' : 'text-text-muted'}`}
                title={capturedFormat ? 'Apply copied formatting to selection' : 'Format painter — copy formatting'}
            >
                <Paintbrush className="w-4 h-4" />
            </button>
            </>)}

            {pluginToolbarButtons.length > 0 && (
                <>
                    <div className="w-px h-4 bg-border-primary mx-1" />
                    <span className="text-[10px] uppercase tracking-wide text-text-muted select-none mr-0.5" title="Buttons added by installed plugins">Plugins</span>
                    {pluginToolbarButtons.map(button => {
                        const Icon = button.icon === 'git-merge' ? GitMerge : Network;
                        return (
                            <button
                                key={button.id}
                                onClick={() => button.onClick(editor)}
                                className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
                                title={button.title || button.label}
                            >
                                <Icon className="w-4 h-4" />
                                <span className="text-xs max-w-[120px] truncate">{button.label}</span>
                            </button>
                        );
                    })}
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

            {showGroup('history') && (<>
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
            </>)}

            {showImageUrl && (
                <PromptModal
                    config={{
                        title: 'Insert image by URL',
                        message: 'Paste an http(s) image URL.',
                        placeholder: 'https://…/image.png',
                        confirmLabel: 'Insert',
                        onConfirm: insertImageUrl,
                    }}
                    onClose={() => setShowImageUrl(false)}
                />
            )}

            {linkDialog && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                    onMouseDown={() => setLinkDialog(null)}
                >
                    <div
                        className="w-[26rem] max-w-[90vw] rounded-lg border border-border-primary bg-bg-secondary p-4 shadow-xl"
                        onMouseDown={e => e.stopPropagation()}
                    >
                        <h3 className="mb-3 text-sm font-semibold text-text-primary">Insert / edit hyperlink</h3>
                        <input
                            ref={linkInputRef}
                            value={linkDialog.url}
                            onChange={e => setLinkDialog(d => (d ? { ...d, url: e.target.value, error: '' } : d))}
                            onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); applyLink(linkDialog.url, linkDialog.newTab); }
                                else if (e.key === 'Escape') { e.preventDefault(); setLinkDialog(null); }
                            }}
                            placeholder="https://example.com"
                            className="w-full rounded border border-border-primary bg-bg-app px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-primary"
                        />
                        {linkDialog.error && <p className="mt-1 text-xs text-red-400">{linkDialog.error}</p>}
                        <label className="mt-3 flex items-center gap-2 text-sm text-text-primary">
                            <input
                                type="checkbox"
                                checked={linkDialog.newTab}
                                onChange={e => setLinkDialog(d => (d ? { ...d, newTab: e.target.checked } : d))}
                            />
                            Open in new tab
                        </label>
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                onClick={() => applyLink('', false)}
                                className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-app"
                                title="Remove the link from the selection"
                            >
                                Remove
                            </button>
                            <button
                                onClick={() => setLinkDialog(null)}
                                className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-app"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => applyLink(linkDialog.url, linkDialog.newTab)}
                                className="rounded bg-accent-primary px-3 py-1.5 text-sm text-white hover:opacity-90"
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
