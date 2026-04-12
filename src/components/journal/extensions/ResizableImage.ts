import Image from '@tiptap/extension-image';

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
        const width = HTMLAttributes.width || HTMLAttributes['data-width'] || '100%';
        const merged = {
            ...HTMLAttributes,
            style: `width:${width};max-width:100%;height:auto;`,
        };

        return ['img', merged];
    },
});

export default ResizableImage;
