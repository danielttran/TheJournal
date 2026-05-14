/**
 * Reading-time and word-count helpers — pure, deterministic, no DOM needed.
 * David RM shows these stats per entry; this module provides the same on top
 * of the editor's HTML payload.
 */

/** Strips HTML tags + collapses whitespace. */
export function stripHtml(html: string): string {
    if (!html) return '';
    // Drop tags, decode the handful of entities the TipTap editor actually
    // emits (&nbsp; &amp; &lt; &gt; &quot; &#39;), collapse runs of whitespace.
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/** Word count from an HTML payload — counts whitespace-separated runs. */
export function wordCount(html: string): number {
    const text = stripHtml(html);
    if (text.length === 0) return 0;
    // \S+ instead of split(' ') so a multi-space gap isn't counted as a word.
    const matches = text.match(/\S+/g);
    return matches ? matches.length : 0;
}

/**
 * Reading time in whole minutes (rounded up; minimum 1 minute when the entry
 * has any words). 225 WPM is the typical adult silent-reading baseline most
 * journaling apps use, including David RM.
 */
export function readingTimeMinutes(html: string, wordsPerMinute = 225): number {
    return readingTimeMinutesFromWords(wordCount(html), wordsPerMinute);
}

/** Same algorithm as readingTimeMinutes but takes a pre-counted word total. */
export function readingTimeMinutesFromWords(words: number, wordsPerMinute = 225): number {
    if (wordsPerMinute <= 0) wordsPerMinute = 225;
    if (!Number.isFinite(words) || words <= 0) return 0;
    return Math.max(1, Math.ceil(words / wordsPerMinute));
}

/** Short label like "1 min read" or "12 min read". Empty string when 0 words. */
export function readingTimeLabel(html: string, wordsPerMinute = 225): string {
    const m = readingTimeMinutes(html, wordsPerMinute);
    return m === 0 ? '' : `${m} min read`;
}
