import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { compileSafeRegex, matchEntryAgainstRegex, SafeRegexError } from "@/lib/regexSearch";

export const dynamic = 'force-dynamic';

// When the user runs a regex search we bypass FTS — there's no index that
// can pre-filter regex matches generically. Cap how many entries we walk
// per request so a worst-case regex on a 100k-entry DB doesn't hang the
// server. Pagination still works via offset on the post-filtered set.
const REGEX_MAX_SCAN = 5000;

interface SearchRow {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CreatedDate: string;
    ModifiedDate: string;
    EntryType: 'Page' | 'Folder';
    CategoryName: string;
    CategoryType: 'Journal' | 'Notebook';
    HtmlContent: string | null;
}

function stripHtml(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<\/div>/gi, ' ')
        .replace(/<\/li>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function extractSnippet(text: string, query: string, windowSize = 100): string {
    const lower = text.toLowerCase();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    let bestIdx = -1;
    for (const term of terms) {
        const idx = lower.indexOf(term);
        if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
    }
    if (bestIdx === -1) return text.substring(0, 200) + (text.length > 200 ? '…' : '');
    const start = Math.max(0, bestIdx - windowSize);
    const end = Math.min(text.length, bestIdx + windowSize + (terms[0]?.length ?? 0));
    return (start > 0 ? '…' : '') + text.substring(start, end) + (end < text.length ? '…' : '');
}

function escapeFtsToken(value: string): string {
    return value.replace(/"/g, '""');
}

function buildFtsMatchQuery(query: string, searchIn: string, wholeWord: boolean): string | null {
    const tokens = query
        .trim()
        .split(/\s+/)
        .map(token => token.trim())
        .filter(Boolean);
    if (!tokens.length) return null;

    const scopedTokens = tokens.map(token => {
        const escaped = escapeFtsToken(token);
        const normalized = wholeWord ? `"${escaped}"` : `"${escaped}"*`;
        if (searchIn === 'title') return `Title:${normalized}`;
        if (searchIn === 'content') return `HtmlContent:${normalized}`;
        return `(Title:${normalized} OR HtmlContent:${normalized})`;
    });
    return scopedTokens.join(' AND ');
}

export async function GET(req: NextRequest) {
    try {
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get('userId');
        if (!userIdCookie?.value) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const userId = Number.parseInt(userIdCookie.value, 10);
        if (Number.isNaN(userId)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const q = (searchParams.get('q') || '').trim();
        const categoryId = searchParams.get('categoryId') || null;
        const dateFrom = searchParams.get('dateFrom') || null;
        const dateTo = searchParams.get('dateTo') || null;
        const searchIn = searchParams.get('searchIn') || 'both';
        const entryType = searchParams.get('entryType') || null;
        const matchCase = searchParams.get('matchCase') === '1';
        const wholeWord = searchParams.get('wholeWord') === '1';
        const regex = searchParams.get('regex') === '1';
        const parsedLimit = Number.parseInt(searchParams.get('limit') || '50', 10);
        const parsedOffset = Number.parseInt(searchParams.get('offset') || '0', 10);
        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
        const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

        if (!q) {
            return NextResponse.json({ results: [], total: 0, hasMore: false });
        }

        const conditions: string[] = ['c.UserID = ?', 'e.IsDeleted = 0'];
        const params: Array<number | string> = [userId];

        if (categoryId) {
            conditions.push('e.CategoryID = ?');
            params.push(Number.parseInt(categoryId, 10));
        }
        if (dateFrom) {
            conditions.push('date(e.CreatedDate) >= ?');
            params.push(dateFrom);
        }
        if (dateTo) {
            conditions.push('date(e.CreatedDate) <= ?');
            params.push(dateTo);
        }
        if (entryType) {
            conditions.push('e.EntryType = ?');
            params.push(entryType);
        }

        // Regex path: skip FTS, fetch a bounded slice of entries matching the
        // SQL-level filters (category/date/etc.), then JS-filter.
        if (regex) {
            let re: RegExp;
            try {
                re = compileSafeRegex(q, { matchCase });
            } catch (err) {
                const msg = err instanceof SafeRegexError ? err.message : 'Invalid regex';
                return NextResponse.json({ error: msg }, { status: 400 });
            }

            const whereClauseRx = conditions.join(' AND ');
            const rxRows = await db.prepare(`
                SELECT
                    e.EntryID, e.Title, e.CategoryID, e.CreatedDate, e.ModifiedDate, e.EntryType,
                    c.Name AS CategoryName, c.Type AS CategoryType,
                    ec.HtmlContent
                FROM Entry e
                JOIN Category c ON e.CategoryID = c.CategoryID
                LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
                WHERE ${whereClauseRx}
                ORDER BY e.ModifiedDate DESC
                LIMIT ?
            `).all<SearchRow>(...params, REGEX_MAX_SCAN);

            const filtered: SearchRow[] = [];
            for (const row of rxRows as SearchRow[]) {
                const plain = row.HtmlContent ? stripHtml(row.HtmlContent) : '';
                const out = matchEntryAgainstRegex(re, {
                    title: row.Title,
                    plainContent: plain,
                    searchIn: searchIn as 'title' | 'content' | 'both',
                });
                if (out.any) filtered.push(row);
            }

            const total = filtered.length;
            const slice = filtered.slice(offset, offset + limit);
            return NextResponse.json({
                results: slice.map(row => {
                    const plain = row.HtmlContent ? stripHtml(row.HtmlContent) : '';
                    re.lastIndex = 0;
                    const titleMatch = re.test(row.Title);
                    re.lastIndex = 0;
                    const contentMatch = re.test(plain);
                    const snippet = contentMatch ? extractSnippet(plain, q) : plain.substring(0, 200) + (plain.length > 200 ? '…' : '');
                    return {
                        EntryID: row.EntryID,
                        Title: row.Title,
                        CategoryID: row.CategoryID,
                        CategoryName: row.CategoryName,
                        CategoryType: row.CategoryType,
                        CreatedDate: row.CreatedDate,
                        ModifiedDate: row.ModifiedDate,
                        EntryType: row.EntryType,
                        snippet,
                        titleMatch,
                        contentMatch,
                    };
                }),
                total,
                hasMore: offset + limit < total,
                scanCapped: rxRows.length >= REGEX_MAX_SCAN,
            });
        }

        const useFts = !matchCase;
        if (useFts) {
            const ftsQuery = buildFtsMatchQuery(q, searchIn, wholeWord);
            if (!ftsQuery) {
                return NextResponse.json({ results: [], total: 0, hasMore: false });
            }
            conditions.push('es MATCH ?');
            params.push(ftsQuery);
        } else {
            const titleExpr = 'e.Title';
            const contentExpr = 'ec.HtmlContent';
            const searchTerm = `%${q}%`;
            if (searchIn === 'title') {
                conditions.push(`${titleExpr} LIKE ?`);
                params.push(searchTerm);
            } else if (searchIn === 'content') {
                conditions.push(`${contentExpr} LIKE ?`);
                params.push(searchTerm);
            } else {
                conditions.push(`(${titleExpr} LIKE ? OR ${contentExpr} LIKE ?)`);
                params.push(searchTerm, searchTerm);
            }
        }

        const whereClause = conditions.join(' AND ');
        const joins = `
            JOIN Category c ON e.CategoryID = c.CategoryID
            LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
            ${useFts ? 'JOIN EntrySearch es ON es.rowid = e.EntryID' : ''}
        `;

        const mapRow = (row: SearchRow) => {
            const plain = row.HtmlContent ? stripHtml(row.HtmlContent) : '';
            const titleMatch = matchCase
                ? row.Title.includes(q)
                : row.Title.toLowerCase().includes(q.toLowerCase());
            const contentMatch = matchCase
                ? plain.includes(q)
                : plain.toLowerCase().includes(q.toLowerCase());
            const snippet = contentMatch
                ? extractSnippet(plain, q)
                : plain.substring(0, 200) + (plain.length > 200 ? '…' : '');

            return {
                EntryID: row.EntryID,
                Title: row.Title,
                CategoryID: row.CategoryID,
                CategoryName: row.CategoryName,
                CategoryType: row.CategoryType,
                CreatedDate: row.CreatedDate,
                ModifiedDate: row.ModifiedDate,
                EntryType: row.EntryType,
                snippet,
                titleMatch,
                contentMatch,
            };
        };

        const countRow = await db.prepare(`
            SELECT COUNT(*) as total
            FROM Entry e
            ${joins}
            WHERE ${whereClause}
        `).get<{ total: number }>(...params);
        const total = countRow?.total ?? 0;

        const rows = await db.prepare(`
            SELECT
                e.EntryID,
                e.Title,
                e.CategoryID,
                e.CreatedDate,
                e.ModifiedDate,
                e.EntryType,
                c.Name AS CategoryName,
                c.Type AS CategoryType,
                ec.HtmlContent
            FROM Entry e
            ${joins}
            WHERE ${whereClause}
            ORDER BY e.ModifiedDate DESC
            LIMIT ? OFFSET ?
        `).all<SearchRow>(...params, limit, offset);

        return NextResponse.json({
            results: rows.map(mapRow),
            total,
            hasMore: offset + limit < total,
        });
    } catch (error) {
        console.error('Search error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
