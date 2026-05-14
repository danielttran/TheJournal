/**
 * Auto-link bare http(s) URLs in HTML text nodes.
 *
 * Approach: walk the HTML linearly, skipping tag bodies (`<...>`) AND skipping
 * anchor element content (`<a>...</a>`) so URLs already inside an anchor are
 * left untouched. URLs in text nodes are replaced with `<a>` elements.
 */

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function transformText(text: string): string {
    return text.replace(URL_RE, (match) => {
        // Strip trailing punctuation that's unlikely to be part of a URL.
        let url = match;
        let trailing = '';
        while (url.length > 0 && /[.,!?;:)\]}>]/.test(url[url.length - 1])) {
            trailing = url[url.length - 1] + trailing;
            url = url.slice(0, -1);
        }
        const safe = escapeAttr(url);
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>${trailing}`;
    });
}

export function autoLinkUrls(html: string): string {
    if (!html) return html;

    let out = '';
    let i = 0;
    while (i < html.length) {
        if (html[i] === '<') {
            // Detect an opening anchor — skip until its closing </a>
            if (/^<a\b/i.test(html.slice(i, i + 3))) {
                const closeIdx = html.toLowerCase().indexOf('</a>', i);
                if (closeIdx === -1) {
                    out += html.slice(i);
                    break;
                }
                out += html.slice(i, closeIdx + 4); // include the </a>
                i = closeIdx + 4;
                continue;
            }
            // Some other tag — pass it through unchanged
            const end = html.indexOf('>', i);
            if (end === -1) { out += html.slice(i); break; }
            out += html.slice(i, end + 1);
            i = end + 1;
        } else {
            const next = html.indexOf('<', i);
            const segment = next === -1 ? html.slice(i) : html.slice(i, next);
            out += transformText(segment);
            i = next === -1 ? html.length : next;
        }
    }
    return out;
}
