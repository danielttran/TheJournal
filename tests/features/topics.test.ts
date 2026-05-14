/**
 * Topic system (DavidRM signature feature).
 *  - Topic table per-user with name, color, optional hotkey 0-9
 *  - createTopic / listTopics / updateTopic / deleteTopic / assignTopic /
 *    unassignTopic / topicsForEntry / entriesForTopic
 *  - Unique name per user (case-insensitive)
 *  - Color must be a valid hex (#rrggbb or #rgb)
 *  - Hotkey 0-9, unique per user when set
 *  - assignTopic on a deleted topic throws
 *  - Cascading: deleting topic clears EntryTopic; deleting entry clears it too
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import {
    createTopic, listTopics, updateTopic, deleteTopic,
    assignTopic, unassignTopic, topicsForEntry, entriesForTopic,
    isValidHexColor,
} from '../../src/lib/topics';

const TEST_DB_PATH = join(process.cwd(), `test-topics-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;
let otherCategoryId: number;

async function entry(title: string, catId = categoryId): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`
    ).run(catId, title, '');
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
    await dbm.prepare('DELETE FROM Topic WHERE UserID IN (?, ?)').run(USER_ID, 99);
    await dbm.prepare(`DELETE FROM Entry WHERE CategoryID IN (?, ?)`).run(categoryId, otherCategoryId);
});

describe('isValidHexColor', () => {
    it.each(['#fff', '#FFF', '#abcdef', '#ABCDEF', '#000000'])('accepts %s', (c) => {
        expect(isValidHexColor(c)).toBe(true);
    });
    it.each(['#ffff', 'red', 'rgb(0,0,0)', '#ggg', ''])('rejects %s', (c) => {
        expect(isValidHexColor(c)).toBe(false);
    });
});

describe('Topic CRUD', () => {
    it('createTopic + listTopics round-trip', async () => {
        const id = await createTopic(dbm, USER_ID, { name: 'Work', color: '#3b82f6' });
        expect(id).toBeGreaterThan(0);
        const list = await listTopics(dbm, USER_ID);
        expect(list.length).toBe(1);
        expect(list[0].Name).toBe('Work');
        expect(list[0].Color).toBe('#3b82f6');
    });

    it('rejects duplicate name per user (case-insensitive)', async () => {
        await createTopic(dbm, USER_ID, { name: 'Work', color: '#fff' });
        await expect(createTopic(dbm, USER_ID, { name: 'work', color: '#000' })).rejects.toThrow();
    });

    it('allows same name across users', async () => {
        await createTopic(dbm, USER_ID, { name: 'Work', color: '#fff' });
        await createTopic(dbm, 99, { name: 'Work', color: '#fff' });
        expect((await listTopics(dbm, USER_ID)).length).toBe(1);
        expect((await listTopics(dbm, 99)).length).toBe(1);
    });

    it('rejects invalid color', async () => {
        await expect(createTopic(dbm, USER_ID, { name: 'X', color: 'red' })).rejects.toThrow();
    });

    it('rejects invalid hotkey (must be 0-9)', async () => {
        await expect(createTopic(dbm, USER_ID, { name: 'X', color: '#fff', hotkey: 10 })).rejects.toThrow();
        await expect(createTopic(dbm, USER_ID, { name: 'Y', color: '#fff', hotkey: -1 })).rejects.toThrow();
    });

    it('rejects duplicate hotkey per user', async () => {
        await createTopic(dbm, USER_ID, { name: 'A', color: '#fff', hotkey: 1 });
        await expect(createTopic(dbm, USER_ID, { name: 'B', color: '#fff', hotkey: 1 })).rejects.toThrow();
    });

    it('updateTopic patches name/color/hotkey', async () => {
        const id = await createTopic(dbm, USER_ID, { name: 'X', color: '#fff' });
        await updateTopic(dbm, USER_ID, id, { name: 'Renamed', color: '#000', hotkey: 2 });
        const list = await listTopics(dbm, USER_ID);
        expect(list[0].Name).toBe('Renamed');
        expect(list[0].Color).toBe('#000');
        expect(list[0].Hotkey).toBe(2);
    });

    it('deleteTopic refuses cross-user', async () => {
        const id = await createTopic(dbm, USER_ID, { name: 'X', color: '#fff' });
        await deleteTopic(dbm, 99, id);
        expect((await listTopics(dbm, USER_ID)).length).toBe(1);
    });
});

describe('Topic assignment to entries', () => {
    it('assignTopic + topicsForEntry round-trip', async () => {
        const t = await createTopic(dbm, USER_ID, { name: 'T', color: '#fff' });
        const e = await entry('hi');
        await assignTopic(dbm, USER_ID, e, t);

        const list = await topicsForEntry(dbm, USER_ID, e);
        expect(list.length).toBe(1);
        expect(list[0].TopicID).toBe(t);
    });

    it('assignTopic is idempotent (duplicate assignments silently ok)', async () => {
        const t = await createTopic(dbm, USER_ID, { name: 'T', color: '#fff' });
        const e = await entry('hi');
        await assignTopic(dbm, USER_ID, e, t);
        await assignTopic(dbm, USER_ID, e, t);
        expect((await topicsForEntry(dbm, USER_ID, e)).length).toBe(1);
    });

    it('unassignTopic removes the link', async () => {
        const t = await createTopic(dbm, USER_ID, { name: 'T', color: '#fff' });
        const e = await entry('hi');
        await assignTopic(dbm, USER_ID, e, t);
        await unassignTopic(dbm, USER_ID, e, t);
        expect((await topicsForEntry(dbm, USER_ID, e)).length).toBe(0);
    });

    it('assignTopic refuses cross-user entry/topic combinations', async () => {
        const myTopic = await createTopic(dbm, USER_ID, { name: 'mine', color: '#fff' });
        const theirEntry = await entry('private', otherCategoryId);
        await expect(assignTopic(dbm, USER_ID, theirEntry, myTopic)).rejects.toThrow();

        const theirTopic = await createTopic(dbm, 99, { name: 'theirs', color: '#fff' });
        const myEntry = await entry('mine');
        await expect(assignTopic(dbm, USER_ID, myEntry, theirTopic)).rejects.toThrow();
    });

    it('entriesForTopic returns all entries assigned to a topic', async () => {
        const t = await createTopic(dbm, USER_ID, { name: 'T', color: '#fff' });
        const a = await entry('a');
        const b = await entry('b');
        await entry('c'); // not assigned
        await assignTopic(dbm, USER_ID, a, t);
        await assignTopic(dbm, USER_ID, b, t);
        const ids = (await entriesForTopic(dbm, USER_ID, t)).map(x => x.EntryID).sort();
        expect(ids).toEqual([a, b].sort());
    });

    it('deleting a topic cascades to EntryTopic', async () => {
        const t = await createTopic(dbm, USER_ID, { name: 'T', color: '#fff' });
        const e = await entry('hi');
        await assignTopic(dbm, USER_ID, e, t);
        await deleteTopic(dbm, USER_ID, t);
        expect((await topicsForEntry(dbm, USER_ID, e)).length).toBe(0);
    });

    it('deleting an entry cascades to EntryTopic', async () => {
        const t = await createTopic(dbm, USER_ID, { name: 'T', color: '#fff' });
        const e = await entry('hi');
        await assignTopic(dbm, USER_ID, e, t);
        await dbm.prepare('DELETE FROM Entry WHERE EntryID = ?').run(e);
        const stillThere = await dbm.prepare('SELECT 1 FROM EntryTopic WHERE EntryID = ?').get(e);
        expect(stillThere).toBeUndefined();
    });
});
