/**
 * Feature: Tags
 *  - Persistence of tags on Entry (JSON string column)
 *  - Distinct-tag aggregation for the /api/tags endpoint
 *  - Filtering entries by one or more tags
 *  - Case-insensitive tag normalization
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { listDistinctTags, filterEntriesByTags, normalizeTag } from '../../src/lib/tags';

const TEST_DB_PATH = join(process.cwd(), `test-tags-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function createEntryWithTags(title: string, tags: string[]): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, Tags) VALUES (?, ?, ?, ?)`
    ).run(categoryId, title, '', JSON.stringify(tags));
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'tags-user');
    const r = await dbm.prepare(
        'INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)'
    ).run(USER_ID, 'Tags Cat', 'Journal');
    categoryId = r.lastInsertRowid;
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Entry WHERE CategoryID = ?').run(categoryId);
});

describe('Tags — normalization', () => {
    it('lowercases, trims, strips commas', () => {
        expect(normalizeTag('  Hello  ')).toBe('hello');
        expect(normalizeTag('Work,')).toBe('work');
        expect(normalizeTag('TRAVEL')).toBe('travel');
    });
    it('returns null/empty for whitespace-only input', () => {
        expect(normalizeTag('   ')).toBe('');
        expect(normalizeTag('')).toBe('');
    });
});

describe('Tags — persistence', () => {
    it('round-trips an array as JSON in Tags column', async () => {
        const id = await createEntryWithTags('e1', ['travel', 'work']);
        const row = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(id) as { Tags: string };
        expect(JSON.parse(row.Tags)).toEqual(['travel', 'work']);
    });

    it('treats an entry without Tags column value as empty array', async () => {
        const r = await dbm.prepare(`INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`).run(categoryId, 'no-tags', '');
        const row = await dbm.prepare('SELECT Tags FROM Entry WHERE EntryID = ?').get(r.lastInsertRowid) as { Tags: string };
        // Column default is '[]'
        expect(JSON.parse(row.Tags || '[]')).toEqual([]);
    });
});

describe('Tags — distinct aggregation', () => {
    it('returns each tag once with correct count, sorted by frequency desc', async () => {
        await createEntryWithTags('a', ['travel', 'work']);
        await createEntryWithTags('b', ['travel']);
        await createEntryWithTags('c', ['work', 'food']);
        await createEntryWithTags('d', ['travel', 'food']);

        const result = await listDistinctTags(dbm, USER_ID);
        const map = new Map(result.map(r => [r.tag, r.count]));
        expect(map.get('travel')).toBe(3);
        expect(map.get('work')).toBe(2);
        expect(map.get('food')).toBe(2);
        expect(result[0].tag).toBe('travel'); // highest count first
    });

    it('returns empty array when no tags exist', async () => {
        const result = await listDistinctTags(dbm, USER_ID);
        expect(result).toEqual([]);
    });

    it('ignores empty arrays', async () => {
        await createEntryWithTags('a', []);
        await createEntryWithTags('b', ['x']);
        const result = await listDistinctTags(dbm, USER_ID);
        expect(result.length).toBe(1);
        expect(result[0].tag).toBe('x');
    });

    it('only counts entries belonging to the requesting user', async () => {
        // create another user with their own category & tagged entry
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'other');
        const other = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(99, 'O', 'Journal');
        await dbm.prepare(`INSERT INTO Entry (CategoryID, Title, PreviewText, Tags) VALUES (?, ?, ?, ?)`)
            .run(other.lastInsertRowid, 'x', '', JSON.stringify(['secret']));
        await createEntryWithTags('mine', ['mine']);

        const result = await listDistinctTags(dbm, USER_ID);
        expect(result.find(r => r.tag === 'secret')).toBeUndefined();
        expect(result.find(r => r.tag === 'mine')).toBeDefined();
    });
});

describe('Tags — filtering', () => {
    it('returns only entries with the requested tag (single)', async () => {
        await createEntryWithTags('a', ['travel']);
        await createEntryWithTags('b', ['work']);
        await createEntryWithTags('c', ['travel', 'work']);
        const ids = await filterEntriesByTags(dbm, USER_ID, ['travel']);
        expect(ids.length).toBe(2);
    });

    it('AND semantics: entry must have ALL requested tags', async () => {
        await createEntryWithTags('a', ['travel']);
        await createEntryWithTags('b', ['travel', 'work']);
        await createEntryWithTags('c', ['travel', 'work', 'food']);
        const ids = await filterEntriesByTags(dbm, USER_ID, ['travel', 'work']);
        expect(ids.length).toBe(2); // b and c
    });

    it('returns empty list when no entry matches', async () => {
        await createEntryWithTags('a', ['x']);
        const ids = await filterEntriesByTags(dbm, USER_ID, ['nope']);
        expect(ids).toEqual([]);
    });

    it('matches case-insensitively', async () => {
        await createEntryWithTags('a', ['travel']);
        const ids = await filterEntriesByTags(dbm, USER_ID, ['TRAVEL']);
        expect(ids.length).toBe(1);
    });
});
