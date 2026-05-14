/**
 * Walk the HTML and apply `fn` to text outside any `<...>` tag.
 * Used by both extractLinkTargets and resolveInternalLinks to avoid
 * touching content inside attribute strings.
 */
function transformTextNodes(html: string, fn: (text: string) => string): string {
    let out = '';
    let i = 0;
    while (i < html.length) {
        if (html[i] === '<') {
            const end = html.indexOf('>', i);
            if (end === -1) { out += html.slice(i); break; }
            out += html.slice(i, end + 1);
            i = end + 1;
        } else {
            const next = html.indexOf('<', i);
            const text = next === -1 ? html.slice(i) : html.slice(i, next);
            out += fn(text);
            i = next === -1 ? html.length : next;
        }
    }
    return out;
}

export function extractLinkTargets(html: string): string[] {
    const out: string[] = [];
    transformTextNodes(html, (text) => {
        const re = /\[\[([^\]\n<>]+)\]\]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) out.push(m[1].trim());
        return text;
    });
    return out;
}

export type EntryLookup = (target: string) => { id: number; title: string } | null;

/**
 * Replace `[[Title]]` and `[[#id]]` tokens with anchor tags. Unresolved links
 * get the `broken-internal-link` class so the UI can style them.
 */
export function resolveInternalLinks(html: string, lookup: EntryLookup): string {
    return transformTextNodes(html, (text) => {
        return text.replace(/\[\[([^\]\n<>]+)\]\]/g, (full, target: string) => {
            const trimmed = target.trim();
            const resolved = lookup(trimmed);
            if (!resolved) {
                return `<span class="broken-internal-link" title="No entry found for: ${escapeAttr(trimmed)}">${escapeText(trimmed)}</span>`;
            }
            return `<a href="journal://entry/${resolved.id}" class="internal-link" data-entry-id="${resolved.id}">${escapeText(resolved.title)}</a>`;
        });
    });
}

function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
function escapeText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
