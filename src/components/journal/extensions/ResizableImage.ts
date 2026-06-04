import Image from '@tiptap/extension-image';
import { sanitizeCssLength } from '@/lib/cssLength';

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
        const width = sanitizeCssLength(HTMLAttributes['data-width']);
        return ['img', {
            ...HTMLAttributes,
            style: `width:${width};max-width:100%;height:auto;`,
        }];
    },
});

export default ResizableImage;
