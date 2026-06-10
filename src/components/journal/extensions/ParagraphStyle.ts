import { Extension } from '@tiptap/core';
import { clampIndent, indentMarginEm } from '@/lib/paragraphStyle';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        paragraphStyle: {
            setLineHeight: (lineHeight: string) => ReturnType;
            unsetLineHeight: () => ReturnType;
            indentBlock: () => ReturnType;
            outdentBlock: () => ReturnType;
            toggleRtlParagraph: () => ReturnType;
        };
    }
}

/**
 * David RM "Paragraph Adjustments" — adds line-spacing and block indentation
 * to paragraphs and headings. Line height is stored as an inline style;
 * indent is a clamped integer level rendered as a left margin (so it survives
 * HTML export and re-parse). Block indent is distinct from list nesting, which
 * the toolbar still routes through sink/lift list-item commands.
 */
export const ParagraphStyle = Extension.create<{ types: string[] }>({
    name: 'paragraphStyle',

    addOptions() {
        return { types: ['paragraph', 'heading'] };
    },

    addGlobalAttributes() {
        return [
            {
                types: this.options.types,
                attributes: {
                    lineHeight: {
                        default: null,
                        parseHTML: (el) => el.style.lineHeight || null,
                        renderHTML: (attrs) =>
                            attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {},
                    },
                    // J8 right-to-left paragraph. Stored as the standard `dir`
                    // attribute so exports/imports and screen readers get it.
                    dir: {
                        default: null,
                        parseHTML: (el) => (el.getAttribute('dir') === 'rtl' ? 'rtl' : null),
                        renderHTML: (attrs) => (attrs.dir === 'rtl' ? { dir: 'rtl' } : {}),
                    },
                    indent: {
                        default: 0,
                        parseHTML: (el) => {
                            const raw = el.getAttribute('data-indent');
                            return raw ? clampIndent(parseInt(raw, 10)) : 0;
                        },
                        renderHTML: (attrs) => {
                            const level = clampIndent(Number(attrs.indent) || 0);
                            if (level <= 0) return {};
                            return { 'data-indent': String(level), style: `margin-left: ${indentMarginEm(level)}em` };
                        },
                    },
                },
            },
        ];
    },

    addCommands() {
        return {
            // Only touch the block type actually under the cursor. Using
            // `.every(updateAttributes)` across all types reports false for the
            // inactive type and made the command's success ambiguous.
            setLineHeight:
                (lineHeight: string) =>
                ({ commands, editor }) => {
                    let ok = false;
                    for (const type of this.options.types) {
                        if (editor.isActive(type)) ok = commands.updateAttributes(type, { lineHeight }) || ok;
                    }
                    return ok;
                },
            unsetLineHeight:
                () =>
                ({ commands, editor }) => {
                    let ok = false;
                    for (const type of this.options.types) {
                        if (editor.isActive(type)) ok = commands.resetAttributes(type, 'lineHeight') || ok;
                    }
                    return ok;
                },
            indentBlock:
                () =>
                ({ commands, editor }) => {
                    for (const type of this.options.types) {
                        if (editor.isActive(type)) {
                            const cur = clampIndent(Number(editor.getAttributes(type).indent) || 0);
                            return commands.updateAttributes(type, { indent: clampIndent(cur + 1) });
                        }
                    }
                    return false;
                },
            outdentBlock:
                () =>
                ({ commands, editor }) => {
                    for (const type of this.options.types) {
                        if (editor.isActive(type)) {
                            const cur = clampIndent(Number(editor.getAttributes(type).indent) || 0);
                            return commands.updateAttributes(type, { indent: clampIndent(cur - 1) });
                        }
                    }
                    return false;
                },
            toggleRtlParagraph:
                () =>
                ({ commands, editor }) => {
                    for (const type of this.options.types) {
                        if (editor.isActive(type)) {
                            const cur = editor.getAttributes(type).dir === 'rtl';
                            return commands.updateAttributes(type, { dir: cur ? null : 'rtl' });
                        }
                    }
                    return false;
                },
        };
    },
});

export default ParagraphStyle;
