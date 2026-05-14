/**
 * Tag rename / merge across all entries.
 *  - renameTag(userId, oldTag, newTag) updates Tags JSON on every entry that has oldTag
 *  - mergeTag(userId, sourceTag, destTag) deletes source from all entries, adds dest if missing
 *  - Case-insensitive match on the source tag
 *  - Tags are normalized (lowercase, trimmed)
 *  - Cross-user entries are not touched
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { renameTag, mergeTag } from '../../src/lib/tagRename';

const TEST_DB_PATH = join(process.cwd(), `test-tagren-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;
let otherCategoryId: number;

async function entry(title: string, tags: string[], catId = categoryId): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, Tags) VALUES (?, ?, ?, ?)`
    ).run(catId, title, '', JSON.stringify(tags));
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 't');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'other');
    const a = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'A', 'Notebook');
    categoryId = a.lastInsertRowid;
    const o = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(99, 'O', 'Notebook');
    otherCategoryId = o.lastInsertRowid;
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare(`DELETE FROM Entry WHERE CategoryID IN (?, ?)`).run(categoryId, otherCategoryId);
});

describe('renameTag', () => {
    it('renames a tag in every entry that has it', async () => {
        const a = await entry('a', ['work']);
        const b = await entry('b', ['work', 'travel']);
        await entry('c', ['travel']); // no rename

        const r = await renameTag(dbm, USER_ID, 'work', 'office');
        expect(r.affectedCount).toBe(2);

        const rowA = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(a) as { Tags: string };
        const rowB = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(b) as { Tags: string };
        expect(JSON.parse(rowA.Tags)).toEqual(['office']);
        expect(JSON.parse(rowB.Tags).sort()).toEqual(['office', 'travel']);
    });

    it('case-insensitive match on the source tag', async () => {
        const a = await entry('a', ['Work']);
        await renameTag(dbm, USER_ID, 'WORK', 'office');
        const rowA = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(a) as { Tags: string };
        expect(JSON.parse(rowA.Tags)).toEqual(['office']);
    });

    it('avoids duplicating when new tag already present', async () => {
        const a = await entry('a', ['work', 'office']);
        await renameTag(dbm, USER_ID, 'work', 'office');
        const rowA = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(a) as { Tags: string };
        expect(JSON.parse(rowA.Tags)).toEqual(['office']);
    });

    it('normalizes the destination tag (trim+lowercase)', async () => {
        const a = await entry('a', ['work']);
        await renameTag(dbm, USER_ID, 'work', '  OFFICE  ');
        const rowA = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(a) as { Tags: string };
        expect(JSON.parse(rowA.Tags)).toEqual(['office']);
    });

    it('does not touch other users\' entries', async () => {
        await entry('mine', ['work']);
        const r = await dbm.prepare(`INSERT INTO Entry (CategoryID, Title, PreviewText, Tags) VALUES (?, ?, ?, ?)`)
            .run(otherCategoryId, 'theirs', '', JSON.stringify(['work']));
        await renameTag(dbm, USER_ID, 'work', 'office');
        const theirs = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(r.lastInsertRowid) as { Tags: string };
        expect(JSON.parse(theirs.Tags)).toEqual(['work']);
    });
});

describe('mergeTag', () => {
    it('removes source tag, ensures dest tag is present', async () => {
        const a = await entry('a', ['work']);
        const b = await entry('b', ['office', 'travel']);
        const c = await entry('c', ['work', 'office']);

        const r = await mergeTag(dbm, USER_ID, 'work', 'office');
        expect(r.affectedCount).toBe(2); // a and c

        const rowA = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(a) as { Tags: string };
        const rowB = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(b) as { Tags: string };
        const rowC = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(c) as { Tags: string };
        expect(JSON.parse(rowA.Tags)).toEqual(['office']);
        expect(JSON.parse(rowB.Tags).sort()).toEqual(['office', 'travel']);
        expect(JSON.parse(rowC.Tags)).toEqual(['office']);
    });
});
