const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(?:$|[?#])/i;

export function isSafeImageUrl(s: string): boolean {
    if (!s || typeof s !== 'string') return false;
    let url: URL;
    try { url = new URL(s); } catch { return false; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (!IMAGE_EXT.test(url.pathname + url.search + url.hash)) return false;
    return true;
}

/**
 * Find paragraphs whose entire content is a single safe image URL and replace
 * them with an `<img>` element. Returns the (possibly-modified) HTML.
 */
function escapeHtmlAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function autoEmbedImageUrls(html: string): string {
    return html.replace(
        /<p>\s*(https?:\/\/[^\s<]+)\s*<\/p>/gi,
        (full, url: string) => {
            if (isSafeImageUrl(url)) {
                return `<p><img src="${escapeHtmlAttr(url)}" alt="" /></p>`;
            }
            return full;
        }
    );
}
