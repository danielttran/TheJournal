/**
 * Hyperlink URL normalisation for the in-app link dialog (J8 "Insert
 * Hyperlink" parity). Pure + DOM-free so the accept/reject rules are
 * unit-tested rather than living inside a React handler.
 *
 * Rules:
 *  - http(s):// URLs pass through (trimmed).
 *  - A bare host like "example.com" or "example.com/path" is promoted to
 *    https:// (common writer expectation; J8 does the same).
 *  - Root-relative paths ("/foo") and internal "journal://" links pass.
 *  - Everything else — notably javascript:, data:, vbscript:, file: and
 *    protocol-relative "//host" — is rejected.
 */

export type NormalizeResult =
    | { ok: true; href: string }
    | { ok: false; reason: string };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'journal:']);

export function normalizeLinkUrl(raw: string): NormalizeResult {
    const url = (raw ?? '').trim();
    if (!url) return { ok: false, reason: 'Enter a URL.' };

    // Protocol-relative URLs are ambiguous and a common injection vector.
    if (url.startsWith('//')) return { ok: false, reason: 'Protocol-relative URLs are not allowed.' };

    // Root-relative path — safe, leave as-is.
    if (url.startsWith('/')) return { ok: true, href: url };

    // Has an explicit scheme?
    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
    if (schemeMatch) {
        const proto = schemeMatch[1].toLowerCase() + ':';
        if (!ALLOWED_PROTOCOLS.has(proto)) {
            return { ok: false, reason: `The "${schemeMatch[1]}" scheme is not allowed.` };
        }
        return { ok: true, href: url };
    }

    // No scheme: treat as a bare host/path and promote to https. Validate the
    // host looks domain-ish (contains a dot, no spaces) so plain words aren't
    // silently turned into links.
    const host = url.split(/[/?#]/, 1)[0];
    if (!host.includes('.') || /\s/.test(url)) {
        return { ok: false, reason: 'Enter a full URL (e.g. https://example.com).' };
    }
    return { ok: true, href: `https://${url}` };
}
