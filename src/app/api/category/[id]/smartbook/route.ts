import { db } from '@/lib/db';
import { authedHandler } from '@/lib/route-helpers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

interface SmartbookQuery {
    q?: string;
    tags?: string[];
    categoryIds?: number[];
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
}

/**
 * Resolve a Smartbook: a dynamic category that auto-collects entries matching
 * a saved query across the user's real categories (DavidRM parity). Returns
 * the matching entries newest-first.
 */
export const GET = authedHandler<[NextRequest, Params]>(
    'GET /api/category/[id]/smartbook',
    async (userId, _req, { params }) => {
        const { id } = await params;
        const categoryId = parseInt(id, 10);

        const cat = await db.prepare(
            'SELECT IsSmartbook, SmartbookQuery FROM Category WHERE CategoryID = ? AND UserID = ?'
        ).get(categoryId, userId) as
            { IsSmartbook: number; SmartbookQuery: string | null } | undefined;

        if (!cat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        if (!cat.IsSmartbook) {
            return NextResponse.json({ error: 'Not a smartbook' }, { status: 400 });
        }

        let query: SmartbookQuery = {};
        try { query = cat.SmartbookQuery ? JSON.parse(cat.SmartbookQuery) : {}; } catch {}

        const where: string[] = ['cat.UserID = ?', 'e.IsDeleted = 0', "e.EntryType = 'Page'"];
        const args: (string | number)[] = [userId];

        if (query.categoryIds?.length) {
            where.push(`e.CategoryID IN (${query.categoryIds.map(() => '?').join(',')})`);
            args.push(...query.categoryIds.map(Number));
        }
        if (query.dateFrom) { where.push('e.CreatedDate >= ?'); args.push(query.dateFrom); }
        if (query.dateTo) { where.push('e.CreatedDate <= ?'); args.push(query.dateTo); }

        let rows: unknown[];
        const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 1000);

        if (query.q && query.q.trim()) {
            const tokens = query.q.trim().split(/\s+/).filter(Boolean)
                .map(t => `(Title:"${t.replace(/"/g, '""')}"* OR HtmlContent:"${t.replace(/"/g, '""')}"*)`);
            const ftsQuery = tokens.join(' AND ');
            rows = await db.prepare(`
                SELECT e.EntryID, e.Title, e.CategoryID, e.CreatedDate, e.ModifiedDate, e.Tags,
                       cat.Name AS CategoryName
                FROM EntrySearch es
                JOIN Entry e ON e.EntryID = es.rowid
                JOIN Category cat ON e.CategoryID = cat.CategoryID
                WHERE es MATCH ? AND ${where.join(' AND ')}
                ORDER BY e.ModifiedDate DESC
                LIMIT ?
            `).all(ftsQuery, ...args, limit);
        } else {
            rows = await db.prepare(`
                SELECT e.EntryID, e.Title, e.CategoryID, e.CreatedDate, e.ModifiedDate, e.Tags,
                       cat.Name AS CategoryName
                FROM Entry e
                JOIN Category cat ON e.CategoryID = cat.CategoryID
                WHERE ${where.join(' AND ')}
                ORDER BY e.ModifiedDate DESC
                LIMIT ?
            `).all(...args, limit);
        }

        // Tag filter is applied in JS because tags are stored as a JSON array.
        let results = rows as { Tags: string | null }[];
        if (query.tags?.length) {
            const want = query.tags.map(t => t.toLowerCase());
            results = results.filter(r => {
                try {
                    const tags: string[] = r.Tags ? JSON.parse(r.Tags) : [];
                    const lower = tags.map(t => t.toLowerCase());
                    return want.every(t => lower.includes(t));
                } catch { return false; }
            });
        }

        return NextResponse.json({ results, total: results.length });
    }
);
