import type { DBManager } from './db';
import { loadEntryHtmlForRead } from './entryEncryption';

/** Strip HTML tags + entities, count whitespace-separated tokens. */
export function countWords(html: string | null | undefined): number {
    if (!html) return 0;
    const text = html
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|h[1-6]|tr|td|th)>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;|&gt;|&quot;|&#39;/gi, ' ')
        .trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
}

export type GoalType = 'daily' | 'total';

export interface WordGoal {
    WordGoalID: number;
    UserID: number;
    Type: GoalType;
    Target: number;
    StartDate: string;
    EndDate: string | null;
    CategoryID: number | null;
    CreatedAt: string;
}

export interface CreateGoalInput {
    type: GoalType;
    target: number;
    startDate: string;
    endDate?: string | null;
    categoryId?: number | null;
}

export async function createGoal(dbm: DBManager, userId: number, input: CreateGoalInput): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO WordGoal (UserID, Type, Target, StartDate, EndDate, CategoryID)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, input.type, input.target, input.startDate, input.endDate ?? null, input.categoryId ?? null);
    return r.lastInsertRowid;
}

export async function getActiveGoals(dbm: DBManager, userId: number): Promise<WordGoal[]> {
    return dbm.prepare(`
        SELECT * FROM WordGoal
        WHERE UserID = ?
          AND (EndDate IS NULL OR date(EndDate) >= date('now', 'localtime'))
        ORDER BY CreatedAt DESC
    `).all(userId) as Promise<WordGoal[]>;
}

export async function deleteGoal(dbm: DBManager, userId: number, goalId: number): Promise<void> {
    await dbm.prepare('DELETE FROM WordGoal WHERE WordGoalID = ? AND UserID = ?').run(goalId, userId);
}

export interface ProgressInput {
    type: GoalType;
    target: number;
    startDate: string;
    endDate: string | null;
    categoryId: number | null;
}

export interface ProgressOutput {
    current: number;
    target: number;
    percent: number;
}

export async function computeProgress(
    dbm: DBManager,
    userId: number,
    input: ProgressInput
): Promise<ProgressOutput> {
    const conditions: string[] = ['c.UserID = ?', 'e.IsDeleted = 0'];
    const params: (string | number)[] = [userId];

    if (input.categoryId) {
        conditions.push('e.CategoryID = ?');
        params.push(input.categoryId);
    }

    if (input.type === 'daily') {
        // CreatedDate is stored naive-local, so compare its bare date() against
        // the local "today". Re-applying 'localtime' to the (already-local)
        // CreatedDate would treat it as UTC and shift it a day in non-UTC zones.
        conditions.push(`date(e.CreatedDate) = date('now', 'localtime')`);
    } else {
        conditions.push(`date(e.CreatedDate) >= ?`);
        params.push(input.startDate);
        if (input.endDate) {
            conditions.push(`date(e.CreatedDate) <= ?`);
            params.push(input.endDate);
        }
    }

    const rows = await dbm.prepare(`
        SELECT e.CategoryID, ec.HtmlContent FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE ${conditions.join(' AND ')}
    `).all(...params) as { CategoryID: number; HtmlContent: string | null }[];

    // Decrypt locked-category content when its EEK is cached; count 0 words when
    // it isn't, so ENC1: ciphertext isn't miscounted as ~1 word toward the goal.
    let current = 0;
    for (const r of rows) {
        const html = await loadEntryHtmlForRead(dbm, userId, r.CategoryID, r.HtmlContent);
        if (html !== null) current += countWords(html);
    }
    const percent = input.target > 0 ? Math.min(100, (current / input.target) * 100) : 0;
    return { current, target: input.target, percent };
}
