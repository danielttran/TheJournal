import type { DBManager } from './db';
import { countWords } from './wordgoals';
import { loadEntryHtmlForRead } from './entryEncryption';

export interface HeatmapCell {
    date: string;       // 'YYYY-MM-DD'
    entryCount: number;
    wordCount: number;
    intensity: 0 | 1 | 2 | 3 | 4;
}

function isLeap(y: number): boolean {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Inclusive range of all days in `year` as 'YYYY-MM-DD'. */
function daysInYear(year: number): string[] {
    const out: string[] = [];
    const monthLengths = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= monthLengths[m - 1]; d++) {
            out.push(`${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
        }
    }
    return out;
}

/**
 * Compute intensity 0..4 for each cell based on word-count quartiles among
 * non-empty days. Empty days always get 0.
 */
function assignIntensities(cells: HeatmapCell[]): void {
    const populated = cells.filter(c => c.wordCount > 0).map(c => c.wordCount).sort((a, b) => a - b);
    if (populated.length === 0) return;
    const q = (p: number) => populated[Math.floor((populated.length - 1) * p)];
    const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75);
    for (const c of cells) {
        if (c.wordCount === 0) { c.intensity = 0; continue; }
        if (c.wordCount <= q1) c.intensity = 1;
        else if (c.wordCount <= q2) c.intensity = 2;
        else if (c.wordCount <= q3) c.intensity = 3;
        else c.intensity = 4;
    }
}

export async function buildHeatmap(dbm: DBManager, userId: number, year: number): Promise<HeatmapCell[]> {
    const rows = await dbm.prepare(`
        SELECT date(e.CreatedDate) AS d, e.CategoryID, ec.HtmlContent
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE c.UserID = ?
          AND e.IsDeleted = 0
          AND strftime('%Y', e.CreatedDate) = ?
    `).all(userId, String(year)) as { d: string; CategoryID: number; HtmlContent: string | null }[];

    const buckets = new Map<string, { entryCount: number; wordCount: number }>();
    for (const r of rows) {
        const b = buckets.get(r.d) ?? { entryCount: 0, wordCount: 0 };
        b.entryCount += 1;
        // Decrypt locked-category content when the EEK is cached; count 0 words
        // when it isn't, so ENC1: ciphertext isn't miscounted as ~1 word.
        const html = await loadEntryHtmlForRead(dbm, userId, r.CategoryID, r.HtmlContent);
        b.wordCount += html !== null ? countWords(html) : 0;
        buckets.set(r.d, b);
    }

    const cells: HeatmapCell[] = daysInYear(year).map(date => {
        const b = buckets.get(date);
        return {
            date,
            entryCount: b?.entryCount ?? 0,
            wordCount: b?.wordCount ?? 0,
            intensity: 0,
        };
    });
    assignIntensities(cells);
    return cells;
}
