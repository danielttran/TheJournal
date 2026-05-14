import type { DBManager } from './db';

export interface ReplaceOptions {
    matchCase: boolean;
    wholeWord: boolean;
}

export interface ReplaceParams extends ReplaceOptions {
    categoryId: number;
    find: string;
    replace: string;
}

export function buildReplaceRegex(find: string, opts: ReplaceOptions): RegExp {
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = opts.wholeWord ? `\\b${escaped}\\b` : escaped;
    return new RegExp(pattern, opts.matchCase ? 'g' : 'gi');
}

/** Count match occurrences in `html`, ignoring text inside tag <...> brackets. */
function countMatches(html: string, regex: RegExp): number {
    const textOnly = html.replace(/<[^>]+>/g, ' ');
    const m = textOnly.match(regex);
    return m ? m.length : 0;
}

/** Replace matches in text nodes only — leave tags untouched. */
function replaceTextOnly(html: string, regex: RegExp, replacement: string): { newHtml: string; count: number } {
    let count = 0;
    const out: string[] = [];
    let i = 0;
    while (i < html.length) {
        if (html[i] === '<') {
            const end = html.indexOf('>', i);
            if (end === -1) { out.push(html.slice(i)); break; }
            out.push(html.slice(i, end + 1));
            i = end + 1;
        } else {
            const next = html.indexOf('<', i);
            const segment = next === -1 ? html.slice(i) : html.slice(i, next);
            const replaced = segment.replace(regex, (m) => { count += 1; return replacement; });
            out.push(replaced);
            i = next === -1 ? html.length : next;
        }
    }
    return { newHtml: out.join(''), count };
}

export async function previewReplace(
    dbm: DBManager,
    userId: number,
    params: ReplaceParams
): Promise<{ affected: { EntryID: number; Title: string; count: number }[]; totalReplacements: number }> {
    const regex = buildReplaceRegex(params.find, params);
    const rows = await dbm.prepare(`
        SELECT e.EntryID, e.Title, ec.HtmlContent
        FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE c.UserID = ? AND e.CategoryID = ? AND e.IsDeleted = 0
    `).all(userId, params.categoryId) as { EntryID: number; Title: string; HtmlContent: string | null }[];

    const affected: { EntryID: number; Title: string; count: number }[] = [];
    let total = 0;
    for (const r of rows) {
        const count = countMatches(r.HtmlContent ?? '', regex);
        if (count > 0) {
            affected.push({ EntryID: r.EntryID, Title: r.Title, count });
            total += count;
        }
    }
    return { affected, totalReplacements: total };
}

export async function executeReplace(
    dbm: DBManager,
    userId: number,
    params: ReplaceParams
): Promise<{ totalEntriesChanged: number; totalReplacements: number }> {
    const regex = buildReplaceRegex(params.find, params);

    let entriesChanged = 0;
    let total = 0;

    // Read inside the transaction so concurrent edits to the same entries
    // can't be silently overwritten — previously the SELECT ran before
    // BEGIN IMMEDIATE, leaving a TOCTOU window between read and update.
    const tx = dbm.transaction(async () => {
        const rows = await dbm.prepare(`
            SELECT e.EntryID, ec.HtmlContent
            FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
            WHERE c.UserID = ? AND e.CategoryID = ? AND e.IsDeleted = 0
        `).all(userId, params.categoryId) as { EntryID: number; HtmlContent: string | null }[];

        for (const row of rows) {
            const { newHtml, count } = replaceTextOnly(row.HtmlContent ?? '', regex, params.replace);
            if (count > 0) {
                await dbm.prepare(
                    `UPDATE EntryContent SET HtmlContent = ? WHERE EntryID = ?`
                ).run(newHtml, row.EntryID);
                await dbm.prepare(
                    `UPDATE Entry SET Version = Version + 1, ModifiedDate = CURRENT_TIMESTAMP WHERE EntryID = ?`
                ).run(row.EntryID);
                entriesChanged += 1;
                total += count;
            }
        }
    });
    await tx();

    return { totalEntriesChanged: entriesChanged, totalReplacements: total };
}
