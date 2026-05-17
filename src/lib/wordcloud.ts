/**
 * Word cloud: tokenize, filter stop-words, count frequencies.
 */

export const STOP_WORDS = new Set<string>([
    'a','an','the','and','or','but','if','then','else','for','of','to','in','on','at',
    'by','from','with','as','is','are','was','were','be','been','being','am',
    'do','does','did','doing','have','has','had','having','can','could','should','would',
    'will','shall','may','might','must','this','that','these','those','i','you','he','she',
    'it','we','they','me','him','her','us','them','my','your','his','its','our','their',
    'what','which','who','whom','where','when','why','how','all','any','some','no','not',
    'so','than','too','very','just','also','only','own','same','such','about','into','over',
    'under','again','more','most','other','out','up','down','off','because','while','during',
    'before','after','between','through','above','below','here','there',
]);

export interface WordCloudOptions {
    limit: number;
    minLength: number;
    stopWords?: Set<string>;
}

export interface WordEntry { word: string; count: number; }

function tokenize(text: string): string[] {
    return text.split(/[^A-Za-z0-9\-]+/).filter(Boolean);
}

function stripHtml(html: string): string {
    // Strip tags, then replace any HTML entity (numeric, hex, or named) with a
    // single space so leftover entities like `&copy;` or `&#8217;` don't get
    // counted as tokens. The tokenizer's [^A-Za-z0-9-]+ split filters out the
    // single space, so we don't need to decode entities to their characters.
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&(?:[a-z][a-z0-9]*|#[0-9]+|#x[0-9a-f]+);/gi, ' ');
}

export function computeWordCloud(
    htmlStrings: string[],
    opts: WordCloudOptions
): WordEntry[] {
    const stop = opts.stopWords ?? STOP_WORDS;
    const counts = new Map<string, number>();
    for (const html of htmlStrings) {
        if (!html) continue;
        const text = stripHtml(html).toLowerCase();
        for (const raw of tokenize(text)) {
            // Trim leading/trailing hyphens
            const word = raw.replace(/^-+|-+$/g, '');
            if (word.length < opts.minLength) continue;
            if (stop.has(word)) continue;
            counts.set(word, (counts.get(word) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
        .slice(0, opts.limit);
}
