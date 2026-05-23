import { db, dbManager } from "@/lib/db";
import { authedHandler } from "@/lib/route-helpers";
import { NextRequest, NextResponse } from "next/server";
import { parseImport, formatFromFilename, type ImportFormat } from "@/lib/importEntries";
import { maybeEncryptForCategory } from "@/lib/entryEncryption";
import { htmlToPlainText } from "@/lib/htmlText";

export const dynamic = 'force-dynamic';

const VALID_FORMATS: ImportFormat[] = ['txt', 'html', 'rtf'];

/**
 * POST /api/category/[id]/import — David RM "Import Entries…". Accepts one or
 * more TXT / HTML / RTF files (multipart `file`), parses each into an entry,
 * and inserts them into the category. Honours per-category encryption.
 */
export const POST = authedHandler<[NextRequest, { params: Promise<{ id: string }> }]>(
    'POST /api/category/[id]/import',
    async (userId, req, { params }) => {
        const categoryId = parseInt((await params).id, 10);
        if (!Number.isFinite(categoryId)) {
            return NextResponse.json({ error: 'Invalid category id' }, { status: 400 });
        }

        const owned = await db.prepare(
            'SELECT 1 FROM Category WHERE CategoryID = ? AND UserID = ?'
        ).get(categoryId, userId);
        if (!owned) return NextResponse.json({ error: 'Category not found' }, { status: 403 });

        const formData = await req.formData();
        const files = formData.getAll('file').filter((f): f is File => f instanceof File);
        if (files.length === 0) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

        const explicit = formData.get('format');
        const explicitFormat = typeof explicit === 'string' && VALID_FORMATS.includes(explicit as ImportFormat)
            ? (explicit as ImportFormat)
            : null;

        const created: number[] = [];
        for (const file of files) {
            const format = explicitFormat ?? formatFromFilename(file.name) ?? 'txt';
            const content = await file.text();
            const fallback = file.name.replace(/\.[^.]+$/, '') || 'Imported';
            const { title, html } = parseImport(content, format, fallback);
            const preview = htmlToPlainText(html).slice(0, 200);

            let storedHtml: string;
            let storedJson: string;
            try {
                const enc = await maybeEncryptForCategory(dbManager, userId, categoryId, html, '');
                storedHtml = enc.html ?? '';
                storedJson = enc.documentJson ?? '';
            } catch (err) {
                if ((err as Error & { code?: string }).code === 'CATEGORY_LOCKED') {
                    return NextResponse.json(
                        { error: 'Category is locked. Unlock it before importing.' },
                        { status: 423 },
                    );
                }
                throw err;
            }

            const insert = db.transaction(async () => {
                const r = await db.prepare(`
                    INSERT INTO Entry (CategoryID, Title, PreviewText, EntryType)
                    VALUES (?, ?, ?, 'Page')
                `).run(categoryId, title, preview);
                await db.prepare(`
                    INSERT INTO EntryContent (EntryID, HtmlContent, DocumentJson)
                    VALUES (?, ?, ?)
                `).run(r.lastInsertRowid, storedHtml, storedJson);
                return r.lastInsertRowid;
            });
            created.push(await insert());
        }

        return NextResponse.json({ imported: created.length, entryIds: created });
    },
);
