import { Mark, mergeAttributes } from '@tiptap/core';
import { INLINE_TAG_ATTR, INLINE_TAG_COLOR_ATTR, normalizeInlineTagName, normalizeTagColor } from '@/lib/inlineTag';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        inlineTag: {
            /** Tag the current selection with a topic (block-level / inline tag). */
            setInlineTag: (name: string, color?: string) => ReturnType;
            /** Remove any inline topic tag from the current selection. */
            unsetInlineTag: () => ReturnType;
        };
    }
}

/**
 * Inline topic tag — a Mark (so it wraps a text selection rather than replacing
 * it) carrying a topic name + color. Renders as a span with a colored dotted
 * underline so the writer can see which words are tagged; persists in the entry
 * HTML (data-tag / data-tag-color) so it round-trips through save/export and
 * the tagged text stays searchable. See src/lib/inlineTag.ts for the pure
 * helpers (name normalization + extraction).
 */
export const InlineTag = Mark.create({
    name: 'inlineTag',
    inclusive: false,

    addAttributes() {
        return {
            name: {
                default: '',
                parseHTML: (el) => el.getAttribute(INLINE_TAG_ATTR) ?? '',
                renderHTML: (attrs) => (attrs.name ? { [INLINE_TAG_ATTR]: attrs.name } : {}),
            },
            color: {
                default: '#888888',
                parseHTML: (el) => el.getAttribute(INLINE_TAG_COLOR_ATTR) ?? '#888888',
                renderHTML: (attrs) => ({ [INLINE_TAG_COLOR_ATTR]: attrs.color }),
            },
        };
    },

    parseHTML() {
        return [{ tag: `span[${INLINE_TAG_ATTR}]` }];
    },

    renderHTML({ HTMLAttributes }) {
        const name = String(HTMLAttributes[INLINE_TAG_ATTR] ?? '');
        const color = normalizeTagColor(String(HTMLAttributes[INLINE_TAG_COLOR_ATTR] ?? ''));
        return [
            'span',
            mergeAttributes(HTMLAttributes, {
                class: 'tj-inline-tag',
                title: name ? `Topic: ${name}` : 'Topic tag',
                style: `text-decoration: underline dotted ${color}; text-underline-offset: 2px;`,
            }),
            0,
        ];
    },

    addCommands() {
        return {
            setInlineTag:
                (name: string, color?: string) =>
                ({ commands }) => {
                    const clean = normalizeInlineTagName(name);
                    if (!clean) return false;
                    return commands.setMark(this.name, { name: clean, color: normalizeTagColor(color) });
                },
            unsetInlineTag:
                () =>
                ({ commands }) => commands.unsetMark(this.name),
        };
    },
});

export default InlineTag;
