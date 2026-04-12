import { type Editor } from '@tiptap/react';
import {
    Bold, Italic, Underline, Strikethrough, Code, Code2,
    Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare,
    Quote, Highlighter, AlignLeft, AlignCenter, AlignRight,
    Image as ImageIcon, Link as LinkIcon, RemoveFormatting,
    Undo, Redo, Minus
} from 'lucide-react';
import { useCallback } from 'react';

export default function TipTapToolbar({ editor }: { editor: Editor | null }) {
    if (!editor) {
        return null;
    }

    const addImage = useCallback(() => {
        const url = window.prompt('Image URL:');
        if (url) {
            editor.chain().focus().setImage({ src: url }).run();
        }
    }, [editor]);

    const setLink = useCallback(() => {
        const previousUrl = editor.getAttributes('link').href;
        const url = window.prompt('URL:', previousUrl);
        
        if (url === null) return;
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }

        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }, [editor]);

    return (
        <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border-primary bg-bg-sidebar">
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
                className={`p-1.5 rounded hover:bg-bg-hover text-text-muted`}
                title="Divider"
            >
                <Minus className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-border-primary mx-1" />

            <button
                onClick={() => editor.chain().focus().toggleHighlight().run()}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('highlight') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Highlight"
            >
                <Highlighter className="w-4 h-4" />
            </button>
            
            <button
                onClick={addImage}
                className={`p-1.5 rounded hover:bg-bg-hover text-text-muted`}
                title="Insert Image"
            >
                <ImageIcon className="w-4 h-4" />
            </button>
            <button
                onClick={setLink}
                className={`p-1.5 rounded hover:bg-bg-hover ${editor.isActive('link') ? 'bg-bg-active text-text-primary' : 'text-text-muted'}`}
                title="Link"
            >
                <LinkIcon className="w-4 h-4" />
            </button>

            <div className="flex-1" />

            <button
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                className={`p-1.5 rounded hover:bg-bg-hover text-text-muted disabled:opacity-30`}
                title="Undo"
            >
                <Undo className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                className={`p-1.5 rounded hover:bg-bg-hover text-text-muted disabled:opacity-30`}
                title="Redo"
            >
                <Redo className="w-4 h-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
                className={`p-1.5 rounded hover:bg-bg-hover text-text-muted`}
                title="Clear Formatting"
            >
                <RemoveFormatting className="w-4 h-4" />
            </button>
        </div>
    );
}
