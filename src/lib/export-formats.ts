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

/**
 * Older sentence-diagram nodes serialized to an *empty* <div> with the rendered
 * SVG stashed in a `data-preview` attribute, so static exports/prints showed a
 * blank box. Newer nodes inline the <svg> directly. This upgrades the legacy
 * form on the fly: when a sentence-diagram div carries `data-preview` but has no
 * inline <svg>, move the decoded SVG inside the div. Idempotent — a no-op on
 * already-inlined diagrams and on HTML without any.
 */
export function inlineDiagramPreviews(html: string | null | undefined): string {
    if (!html) return '';
    // The attribute soup contains '>' inside the quoted data-preview value, so
    // the tag matcher skips whole quoted spans rather than stopping at the first
    // '>'. Literal quotes only ever delimit attributes (any '"' in the SVG is
    // serialized as &quot;), which keeps "[^"]*" reliable.
    const emptyDiagramDiv = /<div\b((?:[^>"]|"[^"]*")*)\bdata-type="sentence-diagram"((?:[^>"]|"[^"]*")*)>\s*<\/div>/g;
    return html.replace(emptyDiagramDiv, (whole, pre: string, post: string) => {
        const attrs = pre + post;
        const m = /\bdata-preview="([^"]*)"/.exec(attrs);
        if (!m) return whole;
        const svg = decodeEntities(m[1]);
        if (!/^\s*<svg[\s>]/i.test(svg)) return whole; // only inline a real SVG
        const cleaned = attrs.replace(/\s*\bdata-preview="[^"]*"/, '');
        return `<div${cleaned} data-type="sentence-diagram">${svg}</div>`;
    });
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

/**
 * Convert an entry's HTML to RTF so it opens with formatting intact in
 * Word / WordPerfect / LibreOffice (DavidRM's primary export format).
 * Handles the common subset TipTap emits: headings, bold/italic/underline,
 * lists, blockquotes, paragraphs and line breaks. Tokenizes tags vs. text so
 * escaping only ever touches text content.
 */
export function exportEntryAsRTF(fm: FrontmatterInput, html: string): string {
    const escText = (s: string): string => {
        let out = '';
        const decoded = decodeEntities(s);
        // Iterate by UTF-16 code units so astral chars (emoji) become valid
        // surrogate-pair \u words; RTF \uN must be a signed 16-bit integer.
        for (let i = 0; i < decoded.length; i++) {
            const ch = decoded[i];
            const code = decoded.charCodeAt(i);
            if (ch === '\\') out += '\\\\';
            else if (ch === '{') out += '\\{';
            else if (ch === '}') out += '\\}';
            else if (code > 127) out += `\\u${code > 32767 ? code - 65536 : code}?`;
            else out += ch;
        }
        return out;
    };

    // Tag matcher tolerates `>` inside quoted attribute values
    // (e.g. <img alt="a>b">) by consuming "…" / '…' segments wholesale.
    const tokenRe = /<\/?([a-z0-9]+)(?:"[^"]*"|'[^']*'|[^>])*>|([^<]+)/gi;
    let out = '';
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(html)) !== null) {
        const tag = m[1]?.toLowerCase();
        const text = m[2];
        if (text !== undefined) { out += escText(text); continue; }
        const closing = m[0].startsWith('</');
        switch (tag) {
            case 'br': out += '\\line '; break;
            case 'hr': out += '\\par\\par '; break;
            case 'p': case 'div': out += closing ? '\\par\n' : ''; break;
            case 'h1': out += closing ? '}\\par\n' : '{\\b\\fs36 '; break;
            case 'h2': out += closing ? '}\\par\n' : '{\\b\\fs30 '; break;
            case 'h3': case 'h4': case 'h5': case 'h6':
                out += closing ? '}\\par\n' : '{\\b\\fs26 '; break;
            case 'b': case 'strong': out += closing ? '}' : '{\\b '; break;
            case 'i': case 'em': out += closing ? '}' : '{\\i '; break;
            case 'u': out += closing ? '}' : '{\\ul '; break;
            case 's': case 'strike': out += closing ? '}' : '{\\strike '; break;
            case 'li': out += closing ? '\\par\n' : '\\bullet  '; break;
            case 'blockquote': out += closing ? '}\\par\n' : '{\\i '; break;
            default: break;
        }
    }

    const header =
        `{\\b\\fs36 ${escText(fm.title || 'Untitled')}}\\par\n` +
        (fm.createdDate ? `{\\i ${escText(fm.createdDate)}}\\par\n` : '') +
        '\\par\n';

    return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\fs22\n${header}${out}\n}`;
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
