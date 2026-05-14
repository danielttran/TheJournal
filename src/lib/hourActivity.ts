import type { DBManager } from './db';
import { countWords } from './wordgoals';

export interface HourBucket {
    hour: number;        // 0..23
    entryCount: number;
    wordCount: number;
}

/**
 * Aggregate entries created in the last `days` days into 24 hourly buckets.
 * Uses SQLite `strftime('%H', ...)` which respects the stored timestamp's
 * local offset — entries stored as 'YYYY-MM-DD HH:MM:SS' are treated as local
 * naive timestamps (matches how the app writes CreatedDate today).
 */
export async function hourActivity(dbm: DBManager, userId: number, days: number): Promise<HourBucket[]> {
    const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;

    const rows = await dbm.prepare(`
        SELECT strftime('%H', e.CreatedDate) AS h, ec.HtmlContent
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE c.UserID = ?
          AND e.IsDeleted = 0
          AND date(e.CreatedDate) >= date('now', 'localtime', ?)
    `).all(userId, `-${safeDays - 1} days`) as { h: string | null; HtmlContent: string | null }[];

    const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, entryCount: 0, wordCount: 0 }));
    for (const row of rows) {
        const h = parseInt(row.h ?? '', 10);
        if (!Number.isFinite(h) || h < 0 || h > 23) continue;
        buckets[h].entryCount += 1;
        buckets[h].wordCount += countWords(row.HtmlContent);
    }
    return buckets;
}
