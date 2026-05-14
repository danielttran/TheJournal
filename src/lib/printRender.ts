/**
 * Render a single journal entry as a self-contained, print-friendly HTML
 * document — David RM parity for "Print" / "Export to PDF". Pure function:
 *   - No DB.
 *   - No DOM (string templating only).
 * Electron's `webContents.printToPDF` can pipe the result; browser print
 * opens it directly.
 */

export interface PrintableEntry {
    title: string;
    htmlContent: string;             // TipTap HTML
    createdDate?: string;            // ISO or display string
    modifiedDate?: string;
    categoryName?: string;
    mood?: string | null;
    tags?: string[];
    author?: string;                 // username / display name
}

const STYLES = `
    :root {
        color-scheme: light;
        --fg: #111;
        --muted: #555;
        --rule: #ddd;
    }
    body {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 12pt;
        line-height: 1.5;
        color: var(--fg);
        margin: 0;
        padding: 1.25in 1in 1in 1in;
        max-width: 6.5in;
    }
    header {
        margin-bottom: 0.75in;
        border-bottom: 1px solid var(--rule);
        padding-bottom: 0.25in;
    }
    header h1 {
        font-size: 22pt;
        margin: 0 0 0.15in 0;
        line-height: 1.2;
    }
    .meta {
        color: var(--muted);
        font-size: 10pt;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5em 1.25em;
    }
    .meta span { white-space: nowrap; }
    .tags { color: var(--muted); font-size: 10pt; margin-top: 0.15in; }
    .tags::before { content: 'Tags: '; }
    article { hyphens: auto; }
    article p { margin: 0 0 0.15in 0; }
    article h1, article h2, article h3 { margin-top: 0.3in; }
    article img { max-width: 100%; height: auto; page-break-inside: avoid; }
    article blockquote {
        margin: 0 0 0.15in 0;
        padding-left: 0.25in;
        border-left: 3px solid var(--rule);
        color: var(--muted);
    }
    article table { border-collapse: collapse; width: 100%; }
    article th, article td {
        border: 1px solid var(--rule);
        padding: 0.05in 0.1in;
        text-align: left;
    }
    @page { margin: 0.75in; }
    @media print { body { padding: 0; max-width: none; } }
`;

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c] as string));
}

/** Returns a complete <!DOCTYPE html> document ready to print or convert to PDF. */
export function renderEntryForPrint(entry: PrintableEntry): string {
    const title = entry.title?.trim() || 'Untitled';
    const safeTitle = escapeHtml(title);
    const meta: string[] = [];
    if (entry.createdDate) meta.push(`<span><strong>Created:</strong> ${escapeHtml(entry.createdDate)}</span>`);
    if (entry.modifiedDate && entry.modifiedDate !== entry.createdDate)
        meta.push(`<span><strong>Modified:</strong> ${escapeHtml(entry.modifiedDate)}</span>`);
    if (entry.categoryName) meta.push(`<span><strong>Journal:</strong> ${escapeHtml(entry.categoryName)}</span>`);
    if (entry.author) meta.push(`<span><strong>Author:</strong> ${escapeHtml(entry.author)}</span>`);
    if (entry.mood) meta.push(`<span><strong>Mood:</strong> ${escapeHtml(entry.mood)}</span>`);

    const tagBlock = entry.tags && entry.tags.length > 0
        ? `<div class="tags">${entry.tags.map(escapeHtml).join(', ')}</div>`
        : '';

    // entry.htmlContent comes from TipTap — already sanitized at the editor
    // boundary. We pass it through verbatim so headings, lists, tables,
    // images, and code blocks render with their authored styles.
    const body = entry.htmlContent ?? '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
<h1>${safeTitle}</h1>
${meta.length > 0 ? `<div class="meta">${meta.join('')}</div>` : ''}
${tagBlock}
</header>
<article>${body}</article>
</body>
</html>`;
}
