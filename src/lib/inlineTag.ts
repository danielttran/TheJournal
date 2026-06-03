/**
 * Inline (block-level) topic tagging — tag a SELECTED span of text with a topic,
 * not just the whole entry. The tag is stored inline in the entry HTML as a
 * <span data-tag="Name" data-tag-color="#rgb">…</span> mark, so it round-trips
 * through save/export and its text stays searchable. Pure helpers here keep the
 * name normalization + HTML extraction testable without the editor.
 */

export const INLINE_TAG_ATTR = 'data-tag';
export const INLINE_TAG_COLOR_ATTR = 'data-tag-color';

export interface InlineTag {
    name: string;
    color: string;
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Trim, collapse internal whitespace, clamp length. Empty → '' (invalid). */
export function normalizeInlineTagName(raw: string): string {
    return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** A safe color for the underline, falling back to a neutral accent. */
export function normalizeTagColor(raw: string | null | undefined): string {
    return raw && HEX_RE.test(raw) ? raw : '#888888';
}

/**
 * Extract the distinct inline tags present in an entry's HTML, in first-seen
 * order. Used to summarize "tags used in this entry" and to feed search. Tag
 * names are matched case-insensitively for dedupe but the first spelling wins.
 */
export function extractInlineTags(html: string): InlineTag[] {
    if (!html) return [];
    const out: InlineTag[] = [];
    const seen = new Set<string>();
    // Match the data-tag attribute and an optional data-tag-color on the same tag.
    const re = /<[^>]*\bdata-tag="([^"]*)"[^>]*?>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        const name = decodeHtml(m[1]).trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const colorMatch = /\bdata-tag-color="([^"]*)"/i.exec(m[0]);
        out.push({ name, color: normalizeTagColor(colorMatch?.[1]) });
    }
    return out;
}

function decodeHtml(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
