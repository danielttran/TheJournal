import type { FrontmatterInput } from './markdown';

const ENTITY_MAP: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
};

function decodeEntities(s: string): string {
    return s.replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/gi, (m) => ENTITY_MAP[m.toLowerCase()] ?? m);
}

export function htmlToPlainText(html: string | null | undefined): string {
    if (!html) return '';
    return decodeEntities(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|h[1-6]|blockquote|pre)>/gi, '\n\n')
            .replace(/<\/(li|tr)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
    )
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Standalone HTML document. Title in `<title>`, content in `<article>`, with
 * an inline `<style>` block so the file renders without external assets.
 */
export function exportEntryAsHTML(fm: FrontmatterInput, html: string): string {
    const title = escapeHtml(fm.title || 'Untitled');
    const tagsHtml = (fm.tags ?? []).map(t => `<span>${escapeHtml(t)}</span>`).join(' ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 2em auto; padding: 0 1em; color: #222; line-height: 1.6; }
  header { border-bottom: 1px solid #ddd; padding-bottom: 0.5em; margin-bottom: 1.5em; }
  h1 { margin: 0; }
  .meta { color: #666; font-size: 0.85em; }
  .meta span { display: inline-block; margin-right: 0.5em; padding: 0.1em 0.5em; background: #eef; border-radius: 0.25em; }
  blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #555; }
  pre { background: #f5f5f5; padding: 0.75em; border-radius: 0.5em; overflow-x: auto; }
  img { max-width: 100%; height: auto; }
</style>
</head>
<body>
<header>
<h1>${title}</h1>
<div class="meta">
${fm.createdDate ? `<time>${escapeHtml(fm.createdDate)}</time>` : ''}
${fm.mood ? `<span>${escapeHtml(fm.mood)}</span>` : ''}
${tagsHtml}
</div>
</header>
<article>
${html}
</article>
</body>
</html>
`;
}

export interface AtomEntry {
    id: number;
    title: string;
    html: string;
    createdDate: string;
    modifiedDate: string;
}

/**
 * ATOM 1.0 feed. Content is type="html" with the body HTML-escaped per RFC 4287
 * (alternative to type="xhtml" which requires well-formed XHTML).
 */
export function exportEntriesAsATOM(entries: AtomEntry[], feedTitle: string): string {
    const updated = entries.length > 0
        ? entries.map(e => e.modifiedDate).sort().reverse()[0]
        : new Date().toISOString();
    const items = entries.map(e => `  <entry>
    <id>tag:thejournal,${e.createdDate}:${e.id}</id>
    <title>${escapeXml(e.title || 'Untitled')}</title>
    <updated>${escapeXml(e.modifiedDate)}</updated>
    <published>${escapeXml(e.createdDate)}</published>
    <content type="html">${escapeXml(e.html)}</content>
  </entry>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(feedTitle)}</title>
  <updated>${escapeXml(updated)}</updated>
  <id>tag:thejournal,feed:${escapeXml(feedTitle)}</id>
${items}
</feed>
`;
}
