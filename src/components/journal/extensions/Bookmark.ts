import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        bookmark: {
            /** Insert a named bookmark anchor at the current selection. */
            setBookmark: (name: string) => ReturnType;
        };
    }
}

/**
 * DavidRM-style in-entry bookmark: a named anchor that internal links can
 * target (e.g. an entry link to "entry#bookmark"). Rendered as a small
 * inline marker so the writer can see where anchors live; it carries an
 * `id` so on-page `#name` navigation works in exported HTML too.
 */
export const Bookmark = Node.create({
    name: 'bookmark',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
        return {
            name: {
                default: '',
                parseHTML: (el) => el.getAttribute('data-bookmark') ?? '',
                renderHTML: (attrs) => ({ 'data-bookmark': attrs.name }),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'a[data-bookmark]' }];
    },

    renderHTML({ HTMLAttributes }) {
        const name = String(HTMLAttributes['data-bookmark'] ?? '');
        return [
            'a',
            mergeAttributes(HTMLAttributes, {
                id: name,
                class: 'tj-bookmark',
                title: `Bookmark: ${name}`,
            }),
            '¶',
        ];
    },

    addCommands() {
        return {
            setBookmark:
                (name: string) =>
                ({ commands }) => {
                    const clean = name.trim();
                    if (!clean) return false;
                    return commands.insertContent({
                        type: this.name,
                        attrs: { name: clean },
                    });
                },
        };
    },
});

export default Bookmark;
