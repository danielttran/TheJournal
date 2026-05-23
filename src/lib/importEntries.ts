/**
 * Per-category content import (David RM "Import Entries…"). Parses TXT / HTML /
 * RTF file content into `{ title, html }` an entry can be created from. Pure +
 * dependency-free so it is unit-testable; the route layer handles upload,
 * ownership, and INSERT.
 *
 * RTF is best-effort text extraction (formatting is not preserved): RTF is a
 * deep nested-group format and full fidelity is out of scope, but the visible
 * prose is recovered into paragraphs.
 */

export type ImportFormat = 'txt' | 'html' | 'rtf';

export interface ParsedImportEntry {
    title: string;
    html: string;
}

const MAX_TITLE = 100;

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripTags(s: string): string {
    return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function deriveTitle(firstLine: string, fallback: string): string {
    const t = firstLine.trim().slice(0, MAX_TITLE).trim();
    return t || fallback;
}

/** Build paragraph HTML from plain text: blank lines split paragraphs, single
 *  newlines become <br>. */
function textToHtml(text: string): string {
    const normalized = text.replace(/\r\n?/g, '\n');
    const blocks = normalized.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    const source = blocks.length ? blocks : normalized.split('\n').map(l => l.trim()).filter(Boolean);
    if (source.length === 0) return '<p></p>';
    return source.map(b => `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`).join('');
}

// ── RTF ──────────────────────────────────────────────────────────────────────

/** Remove balanced `{\name …}` groups (nested-brace aware), including any
 *  ignorable `{\* …}` destination, for the given control-word names. */
function stripRtfGroups(s: string, names: string[]): string {
    const lower = new Set(names.map(n => n.toLowerCase()));
    let out = '';
    let i = 0;
    while (i < s.length) {
        if (s[i] === '{') {
            const rest = s.slice(i + 1);
            const ignorable = /^\\\*/.test(rest);
            const m = rest.match(/^\\\*?\\?([a-zA-Z]+)/);
            if (ignorable || (m && lower.has(m[1].toLowerCase()))) {
                let depth = 0;
                let j = i;
                for (; j < s.length; j++) {
                    if (s[j] === '{') depth++;
                    else if (s[j] === '}') { depth--; if (depth === 0) { j++; break; } }
                }
                i = j;
                continue;
            }
        }
        out += s[i];
        i++;
    }
    return out;
}

export function rtfToPlainText(rtf: string): string {
    let s = rtf;
    // Drop header / non-text destination groups that would otherwise leak
    // font names, colour values, etc. into the output.
    s = stripRtfGroups(s, ['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'generator', 'datastore', 'themedata', 'rsidtbl', 'listtable', 'listoverridetable']);
    // \uN unicode escape (decimal, may be negative) + optional fallback char.
    s = s.replace(/\\u(-?\d+)\s?\??/g, (_m, n) => String.fromCharCode(((parseInt(n, 10) % 65536) + 65536) % 65536));
    // \'hh hex escape (code page byte; treated as latin1).
    s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    // Paragraph breaks → blank line (so textToHtml starts a new <p>); soft line
    // breaks → single newline (<br>); tab → tab. \pard (reset props) is left to
    // the generic control-word stripper so it doesn't inject spurious breaks.
    s = s.replace(/\\(?:par|sect)\b ?/g, '\n\n');
    s = s.replace(/\\line\b ?/g, '\n');
    s = s.replace(/\\tab\b ?/g, '\t');
    // Remaining control words (with optional numeric arg) and control symbols.
    s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, '');
    s = s.replace(/\\[^a-zA-Z]/g, '');
    // Braces are structural only.
    s = s.replace(/[{}]/g, '');
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── HTML ─────────────────────────────────────────────────────────────────────

export function sanitizeImportedHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
        .replace(/javascript:/gi, '')
        .trim();
}

function parseHtmlImport(content: string, fallback: string): ParsedImportEntry {
    const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const inner = bodyMatch ? bodyMatch[1] : content;
    const sanitized = sanitizeImportedHtml(inner);

    const titleTag = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let title = titleTag ? stripTags(titleTag[1]) : '';
    if (!title) {
        const h1 = sanitized.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1) title = stripTags(h1[1]);
    }
    if (!title) title = stripTags(sanitized).slice(0, MAX_TITLE);
    return { title: deriveTitle(title, fallback), html: sanitized || '<p></p>' };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function parseImport(content: string, format: ImportFormat, fallbackTitle: string): ParsedImportEntry {
    if (format === 'html') return parseHtmlImport(content, fallbackTitle);

    const text = format === 'rtf' ? rtfToPlainText(content) : content.replace(/\r\n?/g, '\n');
    const firstLine = text.split('\n').find(l => l.trim().length > 0) ?? '';
    return { title: deriveTitle(firstLine, fallbackTitle), html: textToHtml(text) };
}

/** Maps a filename extension to a supported import format, or null. */
export function formatFromFilename(name: string): ImportFormat | null {
    const ext = name.toLowerCase().split('.').pop();
    if (ext === 'txt' || ext === 'text') return 'txt';
    if (ext === 'htm' || ext === 'html') return 'html';
    if (ext === 'rtf') return 'rtf';
    return null;
}
