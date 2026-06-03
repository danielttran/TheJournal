import type { DBManager } from './db';
import { countWords } from './wordgoals';
import { loadEntryHtmlForRead } from './entryEncryption';
import { normalizeTag } from './tags';

const NOT_DELETED = `e.IsDeleted = 0`;

export async function totalEntries(dbm: DBManager, userId: number): Promise<number> {
    const row = await dbm.prepare(`
        SELECT COUNT(*) AS n FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND ${NOT_DELETED} AND e.EntryType = 'Page'
    `).get(userId) as { n: number };
    return row.n;
}

export async function totalWords(dbm: DBManager, userId: number): Promise<number> {
    const rows = await dbm.prepare(`
        SELECT e.CategoryID, ec.HtmlContent FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE c.UserID = ? AND ${NOT_DELETED}
    `).all(userId) as { CategoryID: number; HtmlContent: string | null }[];
    // Decrypt locked content when the EEK is cached; skip (0) otherwise so raw
    // ENC1: ciphertext isn't miscounted as ~1 word.
    let total = 0;
    for (const r of rows) {
        const html = await loadEntryHtmlForRead(dbm, userId, r.CategoryID, r.HtmlContent);
        if (html !== null) total += countWords(html);
    }
    return total;
}

export interface DayBucket { date: string; count: number; words: number; }

export async function entriesPerDay(dbm: DBManager, userId: number, days: number): Promise<DayBucket[]> {
    // CreatedDate is stored as naive LOCAL time (by-date entries at noon, notebook
    // entries via datetime('now','localtime')), so bucket by date() directly — do
    // NOT re-apply 'localtime', which would treat the naive value as UTC and shift
    // it a day in non-UTC zones. The JS pre-seed below uses local YYYY-MM-DD too,
    // and the range bound stays in local via date('now','localtime', ?).
    const rows = await dbm.prepare(`
        SELECT date(e.CreatedDate) AS d, e.CategoryID, ec.HtmlContent
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE c.UserID = ? AND ${NOT_DELETED}
          AND date(e.CreatedDate) >= date('now', 'localtime', ?)
    `).all(userId, `-${days - 1} days`) as { d: string; CategoryID: number; HtmlContent: string | null }[];

    const map = new Map<string, { count: number; words: number }>();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        map.set(ymd, { count: 0, words: 0 });
    }
    for (const row of rows) {
        const bucket = map.get(row.d);
        if (!bucket) continue;
        bucket.count += 1;
        // Decrypt locked content when its EEK is cached; count 0 otherwise.
        const html = await loadEntryHtmlForRead(dbm, userId, row.CategoryID, row.HtmlContent);
        bucket.words += html !== null ? countWords(html) : 0;
    }
    return [...map.entries()].map(([date, v]) => ({ date, ...v }));
}

async function distinctEntryDates(dbm: DBManager, userId: number): Promise<string[]> {
    // CreatedDate is stored as naive LOCAL time, so date() already yields the
    // user's calendar day. Applying 'localtime' here would re-interpret the
    // naive value as UTC and shift the streak bucket a day in non-UTC zones.
    // The JS callers compare against a local YYYY-MM-DD too.
    const rows = await dbm.prepare(`
        SELECT DISTINCT date(e.CreatedDate) AS d
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND ${NOT_DELETED}
        ORDER BY d ASC
    `).all(userId) as { d: string }[];
    return rows.map(r => r.d);
}

function localYmd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function streaksFromDates(dates: string[]): number[] {
    if (dates.length === 0) return [];
    const runs: number[] = [];
    let run = 1;
    for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1] + 'T00:00:00Z').getTime();
        const cur = new Date(dates[i] + 'T00:00:00Z').getTime();
        const dayDiff = Math.round((cur - prev) / 86400000);
        if (dayDiff === 1) run += 1;
        else { runs.push(run); run = 1; }
    }
    runs.push(run);
    return runs;
}

export async function longestStreak(dbm: DBManager, userId: number): Promise<number> {
    const dates = await distinctEntryDates(dbm, userId);
    const runs = streaksFromDates(dates);
    return runs.length ? Math.max(...runs) : 0;
}

export async function currentStreak(dbm: DBManager, userId: number): Promise<number> {
    const dates = await distinctEntryDates(dbm, userId);
    if (!dates.length) return 0;
    const set = new Set(dates);
    // Operate entirely in local time — distinctEntryDates already returns
    // local YYYY-MM-DD strings, so toISOString (UTC) would mis-bucket near
    // midnight in non-UTC zones.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = localYmd(today);
    let cursor = today;
    if (!set.has(todayStr)) {
        cursor = new Date(today.getTime() - 86400000);
        if (!set.has(localYmd(cursor))) return 0;
    }
    let streak = 0;
    while (set.has(localYmd(cursor))) {
        streak += 1;
        cursor = new Date(cursor.getTime() - 86400000);
    }
    return streak;
}

export async function topTags(dbm: DBManager, userId: number, limit: number): Promise<{ tag: string; count: number }[]> {
    const rows = await dbm.prepare(`
        SELECT e.Tags FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND ${NOT_DELETED}
          AND e.Tags IS NOT NULL AND e.Tags <> '[]'
    `).all(userId) as { Tags: string }[];

    const counts = new Map<string, number>();
    for (const r of rows) {
        let parsed: unknown;
        try { parsed = JSON.parse(r.Tags); } catch { continue; }
        if (!Array.isArray(parsed)) continue;
        for (const t of parsed) {
            if (typeof t !== 'string') continue;
            const k = normalizeTag(t);
            if (!k) continue;
            counts.set(k, (counts.get(k) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

export async function topMoods(dbm: DBManager, userId: number, limit: number): Promise<{ mood: string; count: number }[]> {
    const rows = await dbm.prepare(`
        SELECT e.Mood AS mood, COUNT(*) AS count FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND ${NOT_DELETED} AND e.Mood IS NOT NULL AND e.Mood <> ''
        GROUP BY e.Mood
        ORDER BY count DESC
        LIMIT ?
    `).all(userId, limit) as { mood: string; count: number }[];
    return rows;
}

/**
 * Hour-of-day distribution of journal writing — answers David RM's
 * "When do you write?" view. Returns 24 buckets indexed 0..23.
 *
 * CreatedDate values in this app are stored as local naive timestamps in the
 * form YYYY-MM-DD HH:MM:SS, so do not apply SQLite's 'localtime' modifier here:
 * that treats the stored value as UTC and shifts it a second time.
 */
export async function entriesByHour(
    dbm: DBManager,
    userId: number
): Promise<{ hour: number; count: number }[]> {
    const rows = await dbm.prepare(`
        SELECT CAST(strftime('%H', e.CreatedDate) AS INTEGER) AS hour,
               COUNT(*) AS count
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND ${NOT_DELETED} AND e.EntryType = 'Page'
        GROUP BY hour
    `).all(userId) as { hour: number; count: number }[];

    const out: { hour: number; count: number }[] = [];
    for (let h = 0; h < 24; h++) out.push({ hour: h, count: 0 });
    for (const r of rows) {
        if (r.hour >= 0 && r.hour < 24) out[r.hour].count = r.count;
    }
    return out;
}

/**
 * Day-of-week distribution. Returns 7 buckets indexed by SQLite's strftime('%w'):
 * 0=Sunday, 1=Monday, …, 6=Saturday. Uses the stored local naive CreatedDate
 * directly for the same reason as entriesByHour.
 */
export async function entriesByWeekday(
    dbm: DBManager,
    userId: number
): Promise<{ weekday: number; count: number }[]> {
    const rows = await dbm.prepare(`
        SELECT CAST(strftime('%w', e.CreatedDate) AS INTEGER) AS weekday,
               COUNT(*) AS count
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ? AND ${NOT_DELETED} AND e.EntryType = 'Page'
        GROUP BY weekday
    `).all(userId) as { weekday: number; count: number }[];

    const out: { weekday: number; count: number }[] = [];
    for (let d = 0; d < 7; d++) out.push({ weekday: d, count: 0 });
    for (const r of rows) {
        if (r.weekday >= 0 && r.weekday < 7) out[r.weekday].count = r.count;
    }
    return out;
}

export interface MoodMonth {
    month: string;                       // YYYY-MM
    counts: Record<string, number>;      // mood → count for that month
    total: number;                       // total moodful entries that month
}

/**
 * Mood timeline (David RM parity): aggregate mood counts month-by-month so
 * the UI can render a stacked bar/line chart over time.
 *
 * @param monthsBack How many months of history to include, counting the
 *                   current month. Default 12. Months with zero moods are
 *                   included (counts={}, total=0) so the X-axis is dense.
 */
export async function moodByMonth(
    dbm: DBManager,
    userId: number,
    monthsBack = 12
): Promise<MoodMonth[]> {
    if (monthsBack < 1) monthsBack = 1;
    const rows = await dbm.prepare(`
        SELECT strftime('%Y-%m', e.CreatedDate) AS month,
               e.Mood AS mood,
               COUNT(*) AS count
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE c.UserID = ?
          AND ${NOT_DELETED}
          AND e.Mood IS NOT NULL AND e.Mood <> ''
        GROUP BY month, mood
    `).all(userId) as { month: string; mood: string; count: number }[];

    const map = new Map<string, MoodMonth>();
    const now = new Date();
    for (let i = monthsBack - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        map.set(key, { month: key, counts: {}, total: 0 });
    }
    for (const r of rows) {
        const bucket = map.get(r.month);
        if (!bucket) continue;        // outside the window
        bucket.counts[r.mood] = (bucket.counts[r.mood] ?? 0) + r.count;
        bucket.total += r.count;
    }
    return [...map.values()];
}
