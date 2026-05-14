/**
 * Feature: suggestTags — prefix-filtered autocomplete over existing tags
 *  - Empty prefix returns the top N most-used tags.
 *  - Prefix matches are case-insensitive (normalized).
 *  - Order: usage count desc, then alpha.
 *  - limit caps the result; non-positive returns empty.
 *  - Only the calling user's tags appear.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { suggestTags } from '../../src/lib/tags';

const TEST_DB_PATH = join(process.cwd(), `test-tagsuggest-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
const OTHER_USER_ID = 2;
let categoryId: number;
let otherCategoryId: number;

async function entry(tags: string[], opts: { categoryId?: number } = {}): Promise<number> {
    const cat = opts.categoryId ?? categoryId;
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, EntryType, Tags)
         VALUES (?, '', '', 'Page', ?)`
    ).run(cat, JSON.stringify(tags));
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'me');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(OTHER_USER_ID, 'other');
    const a = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'mine', 'Journal');
    categoryId = a.lastInsertRowid;
    const b = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(OTHER_USER_ID, 'theirs', 'Journal');
    otherCategoryId = b.lastInsertRowid;
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Entry').run();
});

describe('suggestTags', () => {
    it('returns empty for empty cache', async () => {
        expect(await suggestTags(dbm, USER_ID, 'any')).toEqual([]);
    });

    it('empty prefix returns top-N most-used', async () => {
        await entry(['travel']);
        await entry(['travel', 'food']);
        await entry(['travel', 'food', 'family']);
        const out = await suggestTags(dbm, USER_ID, '', 2);
        // travel=3, food=2 → both at limit; family=1 dropped.
        expect(out.map(t => t.tag)).toEqual(['travel', 'food']);
    });

    it('prefix-matches case-insensitively', async () => {
        await entry(['Travel']);
        await entry(['travel-photo']);
        await entry(['food']);
        const out = await suggestTags(dbm, USER_ID, 'tra');
        expect(out.map(t => t.tag).sort()).toEqual(['travel', 'travel-photo']);
    });

    it('orders by count desc then alphabetically', async () => {
        await entry(['banana']);
        await entry(['banana']);
        await entry(['apple']);
        await entry(['avocado']);
        const out = await suggestTags(dbm, USER_ID, '');
        // banana count=2, apple/avocado count=1 each (alpha: apple < avocado)
        expect(out.map(t => t.tag)).toEqual(['banana', 'apple', 'avocado']);
    });

    it('respects limit', async () => {
        for (let i = 0; i < 5; i++) await entry([`tag${i}`]);
        expect(await suggestTags(dbm, USER_ID, '', 3)).toHaveLength(3);
    });

    it('returns empty for non-positive limit', async () => {
        await entry(['anything']);
        expect(await suggestTags(dbm, USER_ID, '', 0)).toEqual([]);
        expect(await suggestTags(dbm, USER_ID, '', -1)).toEqual([]);
    });

    it('is scoped per user', async () => {
        await entry(['mine']);
        await entry(['theirs'], { categoryId: otherCategoryId });
        expect((await suggestTags(dbm, USER_ID, '')).map(t => t.tag)).toEqual(['mine']);
        expect((await suggestTags(dbm, OTHER_USER_ID, '')).map(t => t.tag)).toEqual(['theirs']);
    });
});
