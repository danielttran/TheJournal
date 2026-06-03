import Image from '@tiptap/extension-image';

// The width attribute can originate from pasted / imported HTML (a data-width or
// width attribute on an <img>). It is interpolated into an inline style string,
// so constrain it to a single valid CSS length — a number with an optional unit,
// a percentage, or "auto" — to close a CSS-injection surface. Anything else
// falls back to the default.
function sanitizeWidth(raw: unknown): string {
    const v = typeof raw === 'string' ? raw.trim() : '';
    return /^(auto|\d+(\.\d+)?(px|%|em|rem|vw|vh|ch)?)$/i.test(v) ? v : '100%';
}

const ResizableImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            width: {
                default: '100%',
                parseHTML: element => element.getAttribute('data-width') || element.getAttribute('width') || '100%',
                renderHTML: attributes => ({ 'data-width': attributes.width }),
            },
        };
    },

    renderHTML({ HTMLAttributes }) {
        // HTMLAttributes['data-width'] is the rendered form of our custom `width` attribute.
        const width = sanitizeWidth(HTMLAttributes['data-width']);
        return ['img', {
            ...HTMLAttributes,
            style: `width:${width};max-width:100%;height:auto;`,
        }];
    },
});

export default ResizableImage;
