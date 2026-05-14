export interface OutlineItem {
    level: number;   // 1..6
    text: string;
    anchor: string;
}

const HEADING_RE = /<h([1-6])(\s+[^>]*)?>([\s\S]*?)<\/h\1>/gi;

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .trim()
        // Treat punctuation/symbols as word separators (replace with space) so
        // 'are/you' becomes 'are you' rather than 'areyou'.
        .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function unique(slug: string, seen: Map<string, number>): string {
    if (!slug) return '';
    const count = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, count);
    return count === 1 ? slug : `${slug}-${count}`;
}

export function extractOutline(html: string): OutlineItem[] {
    if (!html) return [];
    const out: OutlineItem[] = [];
    const seen = new Map<string, number>();
    let m: RegExpExecArray | null;
    HEADING_RE.lastIndex = 0;
    while ((m = HEADING_RE.exec(html)) !== null) {
        const level = parseInt(m[1], 10);
        const text = stripTags(m[3]);
        const anchor = unique(slugify(text), seen);
        out.push({ level, text, anchor });
    }
    return out;
}

export function injectHeadingIds(html: string): string {
    if (!html) return html;
    const seen = new Map<string, number>();
    return html.replace(HEADING_RE, (full, lvl: string, attrs: string | undefined, inner: string) => {
        // Skip if id already present
        if (attrs && /\bid\s*=/.test(attrs)) return full;
        const text = stripTags(inner);
        const slug = unique(slugify(text), seen);
        if (!slug) return full;
        const attrStr = attrs ? attrs : '';
        return `<h${lvl} id="${slug}"${attrStr}>${inner}</h${lvl}>`;
    });
}
