import { Node } from '@tiptap/core';
import { sanitizeCssLength } from '@/lib/cssLength';

/**
 * Block-level video node backed by a stored attachment URL. Renders as a
 * standard `<video controls>` element so the OS / browser handles
 * playback — no JS controls, no autoplay.
 *
 * The renderer reads `src` from `data-src` so existing image-paste / paste
 * sanitizers that only let through image URLs don't accidentally upgrade
 * arbitrary `<video>` tags pasted from the web.
 */
export const VideoBlock = Node.create({
    name: 'videoBlock',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
        return {
            src: {
                default: null,
                parseHTML: el => el.getAttribute('data-src') || el.getAttribute('src') || null,
                renderHTML: attrs => attrs.src ? { 'data-src': attrs.src as string } : {},
            },
            mimeType: {
                default: 'video/mp4',
                parseHTML: el => el.getAttribute('data-mime') || 'video/mp4',
                renderHTML: attrs => ({ 'data-mime': attrs.mimeType as string }),
            },
            width: {
                default: '100%',
                parseHTML: el => el.getAttribute('data-width') || '100%',
                renderHTML: attrs => ({ 'data-width': attrs.width as string }),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'video[data-tj-video]' }];
    },

    renderHTML({ HTMLAttributes }) {
        const src = (HTMLAttributes as Record<string, string>)['data-src'];
        const mime = (HTMLAttributes as Record<string, string>)['data-mime'] ?? 'video/mp4';
        const width = sanitizeCssLength((HTMLAttributes as Record<string, string>)['data-width']);
        return [
            'video',
            {
                ...HTMLAttributes,
                'data-tj-video': '1',
                controls: '',
                src: src ?? undefined,
                style: `width:${width};max-width:100%;height:auto;`,
                type: mime,
            },
        ];
    },
});

export default VideoBlock;
