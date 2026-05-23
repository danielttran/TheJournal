import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        fileAttachment: {
            /** Insert a download link to an uploaded file attachment. */
            setFileAttachment: (attrs: { href: string; filename: string; size?: number | null }) => ReturnType;
        };
    }
}

/**
 * David RM "File Attachment" — a download link to an arbitrary uploaded file
 * (stored in the Attachment table, served with a download disposition).
 * Rendered as a non-editable inline chip so it round-trips through save/load
 * and export the same way the Bookmark anchor does.
 */
export const FileAttachment = Node.create({
    name: 'fileAttachment',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
        return {
            href: {
                default: '',
                parseHTML: (el) => el.getAttribute('href') ?? '',
                renderHTML: (attrs) => ({ href: attrs.href }),
            },
            filename: {
                default: 'file',
                parseHTML: (el) => el.getAttribute('data-filename') ?? el.textContent ?? 'file',
                renderHTML: (attrs) => ({ 'data-filename': attrs.filename }),
            },
            size: {
                default: null,
                parseHTML: (el) => {
                    const s = el.getAttribute('data-size');
                    return s ? parseInt(s, 10) : null;
                },
                renderHTML: (attrs) => (attrs.size != null ? { 'data-size': String(attrs.size) } : {}),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'a[data-file-attachment]' }];
    },

    renderHTML({ HTMLAttributes, node }) {
        const fn = String(node.attrs.filename ?? 'file');
        return [
            'a',
            mergeAttributes(HTMLAttributes, {
                'data-file-attachment': '',
                class: 'tj-file-attachment',
                download: fn,
                target: '_blank',
                rel: 'noopener noreferrer',
                title: `Download ${fn}`,
            }),
            fn,
        ];
    },

    addCommands() {
        return {
            setFileAttachment:
                (attrs) =>
                ({ commands }) => {
                    if (!attrs.href) return false;
                    return commands.insertContent({
                        type: this.name,
                        attrs: { href: attrs.href, filename: attrs.filename || 'file', size: attrs.size ?? null },
                    });
                },
        };
    },
});

export default FileAttachment;
