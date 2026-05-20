import type { DBManager } from './db';

const BLANK_DOCUMENT_JSON = JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph' }],
});

const BLANK_PREVIEW = 'Start writing...';

export interface InitialEntryContent {
    html: string;
    documentJson: string;
    previewText: string;
}

/**
 * Pick the template to apply to a new entry in `categoryId`:
 *   1. If `explicitTemplateId` is provided and belongs to `userId`, use it.
 *   2. Else if the category's `AutoTemplateID` references a template owned by
 *      `userId`, use it.
 *   3. Else return a blank doc.
 *
 * The same resolver is used by both POST /api/entry/create and POST
 * /api/entry/by-date so the auto-template feature works whether the user
 * navigates to a new date or explicitly creates a page.
 */
export async function resolveInitialEntryContent(
    dbm: DBManager,
    userId: number,
    categoryId: number,
    opts: { explicitTemplateId?: number | null } = {},
): Promise<InitialEntryContent> {
    let templateId = opts.explicitTemplateId ?? null;
    if (templateId == null || templateId <= 0) {
        const cat = await dbm.prepare(
            'SELECT AutoTemplateID FROM Category WHERE CategoryID = ? AND UserID = ?'
        ).get(categoryId, userId) as { AutoTemplateID: number | null } | undefined;
        templateId = cat?.AutoTemplateID && cat.AutoTemplateID > 0 ? cat.AutoTemplateID : null;
    }

    if (templateId) {
        const tmpl = await dbm.prepare(
            'SELECT HtmlContent, DocumentJson FROM Template WHERE TemplateID = ? AND UserID = ?'
        ).get(templateId, userId) as { HtmlContent: string | null; DocumentJson: string | null } | undefined;

        if (tmpl) {
            const html = tmpl.HtmlContent ?? '';
            const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            return {
                html,
                documentJson: tmpl.DocumentJson ?? BLANK_DOCUMENT_JSON,
                previewText: plain.length > 0 ? plain.substring(0, 200) : BLANK_PREVIEW,
            };
        }
        // Template not found (e.g. deleted, or cross-tenant) → fall through to blank.
    }

    return {
        html: '',
        documentJson: BLANK_DOCUMENT_JSON,
        previewText: BLANK_PREVIEW,
    };
}
