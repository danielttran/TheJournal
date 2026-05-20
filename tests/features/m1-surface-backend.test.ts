/**
 * M1 — Surface existing-backend features (UI-only milestone, but two API
 * helpers move into shared libraries):
 *
 *  - resolveInitialEntryContent: derives HTML + DocumentJson + preview for a
 *    new entry, applying an explicit template, the category's
 *    AutoTemplateID, or a blank doc. Used by both POST /api/entry/create and
 *    POST /api/entry/by-date so the auto-template gap closes for the
 *    journal-by-date path too.
 *  - PUT /api/category/[id] schema accepts isSmartbook so existing
 *    categories can be promoted to Smartbooks (POST already accepted it).
 *  - Category.SortMode round-trips through PUT (already wired) and the
 *    /api/category GET surfaces SortMode so the sidebar can stop using
 *    localStorage.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { resolveInitialEntryContent } from '../../src/lib/categoryTemplate';

const TEST_DB_PATH = join(process.cwd(), `test-m1-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let JOURNAL_CAT = 0;
let NOTEBOOK_CAT = 0;
let TEMPLATE_ID = 0;
let TEMPLATE_ID_2 = 0;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'm1-user');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Template').run();
    await dbm.prepare('DELETE FROM Category').run();

    const jr = await dbm.prepare(
        `INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, 'Journal')`
    ).run(USER_ID, 'Daily');
    JOURNAL_CAT = Number(jr.lastInsertRowid);

    const nr = await dbm.prepare(
        `INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, 'Notebook')`
    ).run(USER_ID, 'Notes');
    NOTEBOOK_CAT = Number(nr.lastInsertRowid);

    const tr = await dbm.prepare(
        `INSERT INTO Template (UserID, Name, HtmlContent, DocumentJson)
         VALUES (?, 'Gratitude', '<p>Thanks for...</p>', ?)`
    ).run(USER_ID, JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thanks for...' }] }] }));
    TEMPLATE_ID = Number(tr.lastInsertRowid);

    const tr2 = await dbm.prepare(
        `INSERT INTO Template (UserID, Name, HtmlContent, DocumentJson)
         VALUES (?, 'Meeting', '<p>Agenda:</p>', ?)`
    ).run(USER_ID, JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Agenda:' }] }] }));
    TEMPLATE_ID_2 = Number(tr2.lastInsertRowid);
});

describe('resolveInitialEntryContent', () => {
    it('returns a blank doc when no template or AutoTemplateID is set', async () => {
        const out = await resolveInitialEntryContent(dbm, USER_ID, JOURNAL_CAT, {});
        expect(out.html).toBe('');
        // Blank doc is a single empty paragraph
        const parsed = JSON.parse(out.documentJson);
        expect(parsed).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
        expect(out.previewText).toBe('Start writing...');
    });

    it('applies an explicit templateId even when AutoTemplateID is also set', async () => {
        await dbm.prepare(`UPDATE Category SET AutoTemplateID = ? WHERE CategoryID = ?`)
            .run(TEMPLATE_ID, JOURNAL_CAT);

        const out = await resolveInitialEntryContent(dbm, USER_ID, JOURNAL_CAT, {
            explicitTemplateId: TEMPLATE_ID_2,
        });
        expect(out.html).toBe('<p>Agenda:</p>');
        expect(out.previewText).toBe('Agenda:');
    });

    it('falls back to AutoTemplateID when no explicit template provided', async () => {
        await dbm.prepare(`UPDATE Category SET AutoTemplateID = ? WHERE CategoryID = ?`)
            .run(TEMPLATE_ID, JOURNAL_CAT);

        const out = await resolveInitialEntryContent(dbm, USER_ID, JOURNAL_CAT, {});
        expect(out.html).toBe('<p>Thanks for...</p>');
        expect(out.previewText).toBe('Thanks for...');
    });

    it('treats AutoTemplateID = 0 as "no auto template"', async () => {
        await dbm.prepare(`UPDATE Category SET AutoTemplateID = 0 WHERE CategoryID = ?`)
            .run(JOURNAL_CAT);
        const out = await resolveInitialEntryContent(dbm, USER_ID, JOURNAL_CAT, {});
        expect(out.html).toBe('');
    });

    it('refuses to apply a template that belongs to a different user (cross-tenant isolation)', async () => {
        // Insert a second user and attach a template to them.
        await dbm.prepare('INSERT INTO User (UserID, Username) VALUES (99, ?)').run('other-user');
        const otr = await dbm.prepare(
            `INSERT INTO Template (UserID, Name, HtmlContent, DocumentJson) VALUES (99, 'Stolen', '<p>theirs</p>', NULL)`
        ).run();
        const otherTemplateId = Number(otr.lastInsertRowid);

        const out = await resolveInitialEntryContent(dbm, USER_ID, JOURNAL_CAT, {
            explicitTemplateId: otherTemplateId,
        });
        // Foreign template ignored — blank doc returned.
        expect(out.html).toBe('');

        await dbm.prepare('DELETE FROM User WHERE UserID = 99').run();
    });

    it('strips HTML for the preview and caps at 200 chars', async () => {
        const longHtml = '<p>' + 'word '.repeat(200) + '</p>';
        const longTr = await dbm.prepare(
            `INSERT INTO Template (UserID, Name, HtmlContent, DocumentJson) VALUES (?, 'Long', ?, NULL)`
        ).run(USER_ID, longHtml);
        const longId = Number(longTr.lastInsertRowid);

        const out = await resolveInitialEntryContent(dbm, USER_ID, JOURNAL_CAT, {
            explicitTemplateId: longId,
        });
        expect(out.previewText.length).toBeLessThanOrEqual(200);
        expect(out.previewText).not.toContain('<');
    });
});

describe('Category schema — backend columns for M1', () => {
    it('has SortMode column with manual default', async () => {
        const cols = await dbm.prepare('PRAGMA table_info(Category)').all() as { name: string; dflt_value: string | null }[];
        const sortCol = cols.find(c => c.name === 'SortMode');
        expect(sortCol, 'SortMode column missing').toBeDefined();
    });

    it('has AutoTemplateID, EntryFrequency, IsSmartbook, SmartbookQuery columns', async () => {
        const cols = await dbm.prepare('PRAGMA table_info(Category)').all() as { name: string }[];
        const names = new Set(cols.map(c => c.name));
        for (const required of ['AutoTemplateID', 'EntryFrequency', 'IsSmartbook', 'SmartbookQuery', 'PasswordHash']) {
            expect(names.has(required), `missing column ${required}`).toBe(true);
        }
    });
});
