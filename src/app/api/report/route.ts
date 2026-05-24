import { db, dbManager } from '@/lib/db';
import { authedHandler } from '@/lib/route-helpers';
import { exportEntryAsRTF, htmlToPlainText, inlineDiagramPreviews } from '@/lib/export-formats';
import { loadEntryHtmlForRead } from '@/lib/entryEncryption';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface ReportRow {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    CreatedDate: string;
    ModifiedDate: string;
    Tags: string | null;
    Mood: string | null;
    HtmlContent: string | null;
}

function wordCount(html: string | null): number {
    const text = htmlToPlainText(html).trim();
    return text ? text.split(/\s+/).length : 0;
}

/**
 * Entry Report Wizard (DavidRM parity): compile every entry matching a
 * date range / category / tag filter into one document, with a summary
 * header (entry count, total words). Formats: html (default) or rtf.
 *
 * Query params: from, to (ISO dates), categoryIds (comma list), tag,
 * format (html|rtf).
 */
export const GET = authedHandler<[NextRequest]>('GET /api/report', async (userId, req) => {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const tag = searchParams.get('tag');
    const format = (searchParams.get('format') ?? 'html').toLowerCase();
    const categoryIds = (searchParams.get('categoryIds') ?? '')
        .split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n));

    const where: string[] = ['cat.UserID = ?', 'e.IsDeleted = 0', "e.EntryType = 'Page'"];
    const args: (string | number)[] = [userId];
    if (categoryIds.length) {
        where.push(`e.CategoryID IN (${categoryIds.map(() => '?').join(',')})`);
        args.push(...categoryIds);
    }
    if (from) { where.push('e.CreatedDate >= ?'); args.push(from); }
    if (to) { where.push('e.CreatedDate <= ?'); args.push(`${to} 23:59:59`); }

    let rows = await db.prepare(`
        SELECT e.EntryID, e.Title, e.CategoryID, cat.Name AS CategoryName,
               e.CreatedDate, e.ModifiedDate, e.Tags, e.Mood, ec.HtmlContent
        FROM Entry e
        JOIN Category cat ON e.CategoryID = cat.CategoryID
        LEFT JOIN EntryContent ec ON e.EntryID = ec.EntryID
        WHERE ${where.join(' AND ')}
        ORDER BY e.CreatedDate ASC
    `).all(...args) as ReportRow[];

    if (tag) {
        const want = tag.toLowerCase();
        rows = rows.filter(r => {
            try {
                const tags: string[] = r.Tags ? JSON.parse(r.Tags) : [];
                return tags.map(t => t.toLowerCase()).includes(want);
            } catch { return false; }
        });
    }

    // Decrypt password-locked content before assembling the report. If any
    // category in the result set is locked and its EEK isn't cached, refuse
    // the whole report — partial output with ciphertext rows would defeat
    // the lock.
    for (let i = 0; i < rows.length; i++) {
        const decrypted = await loadEntryHtmlForRead(dbManager, userId, rows[i].CategoryID, rows[i].HtmlContent);
        if (decrypted === null) {
            return NextResponse.json(
                { error: 'One or more categories in the report are locked. Unlock them first.' },
                { status: 423 },
            );
        }
        rows[i] = { ...rows[i], HtmlContent: inlineDiagramPreviews(decrypted) };
    }

    const totalWords = rows.reduce((s, r) => s + wordCount(r.HtmlContent), 0);
    const rangeLabel = `${from || 'beginning'} → ${to || 'now'}`;

    if (format === 'rtf') {
        const docs = rows.map(r => {
            const fm = { title: r.Title || 'Untitled', createdDate: r.CreatedDate, modifiedDate: r.ModifiedDate, tags: [], mood: r.Mood ?? null };
            return exportEntryAsRTF(fm, r.HtmlContent ?? '')
                .replace(/^\{\\rtf1[^\n]*\n/, '').replace(/\n\}$/, '');
        }).join('\\par\\par ');
        const summary = `{\\b Entry Report}\\par ${rows.length} entries, ${totalWords} words, ${rangeLabel}\\par\\par `;
        const body = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\fs22\n${summary}${docs}\n}`;
        return new NextResponse(body, {
            headers: {
                'Content-Type': 'application/rtf; charset=utf-8',
                'Content-Disposition': 'attachment; filename="entry-report.rtf"',
            },
        });
    }

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const articles = rows.map(r => `
<article style="border-bottom:1px solid #ddd;padding:1.5em 0;">
  <h2 style="margin:0">${esc(r.Title || 'Untitled')}</h2>
  <div style="color:#666;font-size:.85em;margin:.25em 0 1em">
    ${esc(r.CategoryName)} · ${esc(r.CreatedDate)} · ${wordCount(r.HtmlContent)} words
  </div>
  ${r.HtmlContent ?? ''}
</article>`).join('\n');

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>Entry Report</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:2em auto;padding:0 1em;color:#222;line-height:1.6}img{max-width:100%}blockquote{border-left:3px solid #ccc;padding-left:1em;color:#555}</style>
</head><body>
<header style="border-bottom:2px solid #333;padding-bottom:1em;margin-bottom:1em">
<h1 style="margin:0">Entry Report</h1>
<p style="color:#666">${rows.length} entries · ${totalWords} words · ${esc(rangeLabel)}</p>
</header>
${articles || '<p>No entries matched the report criteria.</p>'}
</body></html>`;

    return new NextResponse(html, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': 'attachment; filename="entry-report.html"',
        },
    });
});
