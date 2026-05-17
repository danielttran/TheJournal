import { db } from '@/lib/db';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Decode the small set of XML entities ENEX uses in titles. */
function decodeXml(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** Pull the inner XHTML out of an ENML `<en-note>…</en-note>` body. */
function extractBody(content: string): string {
    const cdata = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    const raw = cdata ? cdata[1] : content;
    const note = raw.match(/<en-note[^>]*>([\s\S]*?)<\/en-note>/i);
    let html = (note ? note[1] : raw).trim();
    // ENEX media/encrypted blocks have no web equivalent — drop them.
    html = html.replace(/<en-media[^>]*\/?>/gi, '')
        .replace(/<en-crypt[^>]*>[\s\S]*?<\/en-crypt>/gi, '');
    return html || '<p></p>';
}

/**
 * Evernote .enex importer (DavidRM import parity). Parses notes and creates
 * one Page entry per note in the chosen category. Self-contained regex parser
 * so no XML dependency is needed.
 */
export async function POST(req: NextRequest) {
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

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const categoryId = parseInt(String(formData.get('categoryId') ?? ''), 10);
        if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        if (isNaN(categoryId)) return NextResponse.json({ error: 'categoryId required' }, { status: 400 });

        const owns = await db.prepare(
            'SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?'
        ).get(categoryId, userId);
        if (!owns) return NextResponse.json({ error: 'Category not found or unauthorized' }, { status: 403 });

        const xml = await file.text();
        const noteRe = /<note>([\s\S]*?)<\/note>/gi;
        const notes: { title: string; html: string; created: string | null }[] = [];
        let m: RegExpExecArray | null;
        while ((m = noteRe.exec(xml)) !== null) {
            const block = m[1];
            const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
            const contentMatch = block.match(/<content>([\s\S]*?)<\/content>/i);
            const createdMatch = block.match(/<created>([\s\S]*?)<\/created>/i);
            const title = titleMatch ? decodeXml(titleMatch[1].trim()) : 'Untitled';
            const html = contentMatch ? extractBody(contentMatch[1]) : '<p></p>';
            // ENEX timestamps look like 20240115T133000Z → ISO.
            let created: string | null = null;
            if (createdMatch) {
                const t = createdMatch[1].trim();
                const iso = t.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
                    '$1-$2-$3T$4:$5:$6Z');
                if (!isNaN(Date.parse(iso))) created = iso;
            }
            notes.push({ title: title || 'Untitled', html, created });
        }

        if (notes.length === 0) {
            return NextResponse.json({ error: 'No notes found in file' }, { status: 400 });
        }

        const importNotes = db.transaction(async () => {
            let imported = 0;
            for (const n of notes) {
                const preview = n.html.replace(/<[^>]+>/g, ' ').trim().slice(0, 200);
                const res = await db.prepare(`
                    INSERT INTO Entry (CategoryID, Title, PreviewText, EntryType, CreatedDate)
                    VALUES (?, ?, ?, 'Page', COALESCE(?, CURRENT_TIMESTAMP))
                `).run(categoryId, n.title, preview || 'Imported note', n.created);
                await db.prepare(`
                    INSERT INTO EntryContent (EntryID, HtmlContent, DocumentJson)
                    VALUES (?, ?, NULL)
                `).run(res.lastInsertRowid, n.html);
                imported++;
            }
            return imported;
        });

        const imported = await importNotes();
        return NextResponse.json({ imported });
    } catch (error) {
        console.error('Evernote import failed:', error);
        return NextResponse.json({ error: 'Import failed' }, { status: 500 });
    }
}
