import { stripHtml, wordCount } from './readingTime';

/**
 * Per-entry statistics for the David RM "Entry Properties" dialog. Pure
 * helper over the editor's HTML payload so it's testable without a DOM.
 */
export interface EntryStats {
    words: number;
    /** Visible-text character count (tags stripped, whitespace collapsed). */
    characters: number;
    charactersNoSpaces: number;
}

export function computeEntryStats(html: string): EntryStats {
    const text = stripHtml(html);
    return {
        words: wordCount(html),
        characters: text.length,
        charactersNoSpaces: text.replace(/\s/g, '').length,
    };
}
