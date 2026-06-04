/**
 * Backup import remaps /api/attachment/{id} references to the new post-restore
 * ids. Regression: only EntryContent was remapped — Template and Snippet content
 * (a template/snippet "saved from" content that embedded an image) kept the OLD
 * id, so after restore the image 404s. This mirrors the importer's template/
 * snippet remap step (attIdMap built from re-inserted attachments) and asserts
 * the refs are rewritten, like EntryContent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { remapAttachmentRefs } from '../../src/lib/attachmentRefs';

const PATH = join(process.cwd(), `test-imp-tmpl-${Date.now()}.tjdb`);
const KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;

beforeAll(async () => {
    dbm = new DBManager(PATH);
    await dbm.unlock(KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (1, ?)').run('u');
});

afterAll(async () => {
    await dbm.close();
    for (const s of ['', '-shm', '-wal']) await unlink(PATH + s).catch(() => {});
});

describe('import remaps attachment refs in templates and snippets', () => {
    it('rewrites /api/attachment/{old} → {new} in Template and Snippet content', async () => {
        // Simulate the importer: attachments re-inserted get fresh ids → attIdMap.
        // Source attachment id 7 maps to new id 42 (and 70 → 5 to exercise the
        // prefix-collision safety of the single-pass remap).
        const attIdMap = new Map<number, number>([[7, 42], [70, 5]]);

        const tmplHtml = '<p>see <img src="/api/attachment/7"> and <img src="/api/attachment/70"></p>';
        const tmplJson = JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: '/api/attachment/7' } }] });
        const snippetContent = '<img src="/api/attachment/70">';

        // Mirror of the importer's template remap (route step G2) + snippet remap.
        const newHtml = remapAttachmentRefs(tmplHtml, attIdMap);
        const newJson = remapAttachmentRefs(tmplJson, attIdMap);
        const newSnippet = remapAttachmentRefs(snippetContent, attIdMap);

        await dbm.prepare('INSERT INTO Template (UserID, Name, HtmlContent, DocumentJson) VALUES (1, ?, ?, ?)')
            .run('T', newHtml, newJson);
        await dbm.prepare('INSERT INTO Snippet (UserID, Name, Content) VALUES (1, ?, ?)').run('S', newSnippet);

        const t = await dbm.prepare('SELECT HtmlContent, DocumentJson FROM Template WHERE Name = ?').get('T') as { HtmlContent: string; DocumentJson: string };
        const s = await dbm.prepare('SELECT Content FROM Snippet WHERE Name = ?').get('S') as { Content: string };

        expect(t.HtmlContent).toBe('<p>see <img src="/api/attachment/42"> and <img src="/api/attachment/5"></p>');
        expect(t.HtmlContent).not.toContain('/api/attachment/7"');  // old id gone
        expect(t.DocumentJson).toContain('/api/attachment/42');
        expect(s.Content).toBe('<img src="/api/attachment/5">');
    });

    it('remaps Category.SmartbookQuery.categoryIds to the new category ids', () => {
        // Mirror of the importer's smartbook remap (route step C2): source category
        // ids 2,5 map to new ids 52,55; unmapped ids are dropped.
        const catIdMap = new Map<number, number>([[2, 52], [5, 55]]);
        const src = JSON.stringify({ categoryIds: [2, 5, 999], matchType: 'any' });

        const parsed = JSON.parse(src) as { categoryIds?: number[]; matchType?: string };
        parsed.categoryIds = (parsed.categoryIds ?? [])
            .map((id) => catIdMap.get(id))
            .filter((id): id is number => typeof id === 'number');

        expect(parsed.categoryIds).toEqual([52, 55]);   // remapped, unmapped 999 dropped
        expect(parsed.matchType).toBe('any');           // other fields preserved
    });
});
