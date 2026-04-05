import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

// Strip HTML tags and collapse whitespace for plain-text snippet extraction
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

// Extract a snippet of text centered around the first match of `query`.
// Returns ~200 chars with ellipses where text is truncated.
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

export async function GET(req: NextRequest) {
    try {
        const cookieStore = await cookies();
        const userIdCookie = cookieStore.get('userId');
        if (!userIdCookie?.value) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const userId = parseInt(userIdCookie.value, 10);
        if (isNaN(userId)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const q = (searchParams.get('q') || '').trim();
        const categoryId = searchParams.get('categoryId') || null;
        const dateFrom = searchParams.get('dateFrom') || null;
        const dateTo = searchParams.get('dateTo') || null;
        // searchIn: 'title' | 'content' | 'both'
        const searchIn = searchParams.get('searchIn') || 'both';
        const entryType = searchParams.get('entryType') || null; // 'Page' | 'Section' | null
        const matchCase = searchParams.get('matchCase') === '1';
        const wholeWord = searchParams.get('wholeWord') === '1';
        const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        if (!q) {
            return NextResponse.json({ results: [], total: 0, hasMore: false });
        }

        // Build the LIKE pattern. For whole-word matching we check word boundaries in app code.
        const likePattern = matchCase ? `%${q}%` : `%${q.toLowerCase()}%`;

        // Build WHERE clauses
        const conditions: string[] = ['c.UserID = ?'];
        const params: any[] = [userId];

        if (categoryId) {
            conditions.push('e.CategoryID = ?');
            params.push(parseInt(categoryId, 10));
        }
        if (dateFrom) {
            conditions.push("date(e.CreatedDate) >= ?");
            params.push(dateFrom);
        }
        if (dateTo) {
            conditions.push("date(e.CreatedDate) <= ?");
            params.push(dateTo);
        }
        if (entryType) {
            conditions.push('e.EntryType = ?');
            params.push(entryType);
        }

        // Content match clause depends on searchIn and matchCase
        const titleExpr = matchCase ? 'e.Title' : 'lower(e.Title)';
        const contentExpr = matchCase ? 'ec.HtmlContent' : 'lower(ec.HtmlContent)';
        const searchTerm = matchCase ? `%${q}%` : `%${q.toLowerCase()}%`;

        if (searchIn === 'title') {
            conditions.push(`${titleExpr} LIKE ?`);
            params.push(searchTerm);
        } else if (searchIn === 'content') {
            conditions.push(`${contentExpr} LIKE ?`);
            params.push(searchTerm);
        } else {
            // both
            conditions.push(`(${titleExpr} LIKE ? OR ${contentExpr} LIKE ?)`);
            params.push(searchTerm, searchTerm);
        }

        const whereClause = conditions.join(' AND ');

        // Count total matches
        const countRow = await db.prepare(`
            SELECT COUNT(*) as total
            FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
            WHERE ${whereClause}
        `).get(...params) as { total: number };

        const total = countRow?.total ?? 0;

        // Fetch paginated results
        const rows = await db.prepare(`
            SELECT
                e.EntryID,
                e.Title,
                e.CategoryID,
                e.CreatedDate,
                e.ModifiedDate,
                e.EntryType,
                c.Name   AS CategoryName,
                c.Type   AS CategoryType,
                ec.HtmlContent
            FROM Entry e
            JOIN Category c ON e.CategoryID = c.CategoryID
            LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
            WHERE ${whereClause}
            ORDER BY e.ModifiedDate DESC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset) as any[];

        const results = rows.map(row => {
            const plain = row.HtmlContent ? stripHtml(row.HtmlContent) : '';
            const titleMatch = matchCase
                ? row.Title.includes(q)
                : row.Title.toLowerCase().includes(q.toLowerCase());
            const contentMatch = matchCase
                ? plain.includes(q)
                : plain.toLowerCase().includes(q.toLowerCase());

            // Post-filter whole-word if requested
            if (wholeWord) {
                const re = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, matchCase ? '' : 'i');
                if (!re.test(row.Title) && !re.test(plain)) return null;
            }

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
        }).filter(Boolean);

        return NextResponse.json({ results, total, hasMore: offset + limit < total });

    } catch (error) {
        console.error('Search error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
