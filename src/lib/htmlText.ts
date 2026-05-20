/**
 * Convert TipTap-produced HTML into a plain-text preview string.
 *
 * Differs from `lib/readingTime.ts#stripHtml` in two important ways:
 *   - Strips the CONTENT of <style> and <script> blocks (not just the tags),
 *     so a stray style attribute doesn't end up in the preview.
 *   - Preserves block boundaries with `\n`, so a multi-paragraph entry
 *     shows distinguishable lines in previews / autosave fallbacks.
 *
 * Pure and synchronous — no DOM dependency. Used by Editor's autosave hot
 * path (preview text derivation, title extraction) where touching `document`
 * causes layout thrashing.
 *
 * For word counts use `wordCount` from lib/readingTime which collapses
 * whitespace differently; for search snippets use the local helper in the
 * search route which optimises for inline display.
 */
export function htmlToPlainText(html: string): string {
    if (!html) return '';
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/gi, "'");
}
