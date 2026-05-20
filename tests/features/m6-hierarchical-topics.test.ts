/**
 * M6.17 — Hierarchical topics.
 *
 *  - Topic gains a nullable ParentTopicID column.
 *  - createTopic / updateTopic accept parentTopicId.
 *  - moveTopic guards against cycles (child cannot become its own ancestor).
 *  - listTopics still returns a flat list but each row carries ParentTopicID
 *    so the UI can render a tree.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { createTopic, updateTopic, listTopics, moveTopic } from '../../src/lib/topics';

const TEST_DB_PATH = join(process.cwd(), `test-m6-topics-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'topics-user');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Topic').run();
});

describe('Hierarchical topics — schema', () => {
    it('Topic has ParentTopicID', async () => {
        const cols = await dbm.prepare('PRAGMA table_info(Topic)').all() as { name: string }[];
        const names = new Set(cols.map(c => c.name));
        expect(names.has('ParentTopicID'), 'missing ParentTopicID column').toBe(true);
    });
});

describe('createTopic with parent', () => {
    it('creates a child topic under an existing parent', async () => {
        const parent = await createTopic(dbm, USER_ID, { name: 'Work', color: '#abc' });
        const child = await createTopic(dbm, USER_ID, { name: 'OKRs', color: '#def', parentTopicId: parent });
        const list = await listTopics(dbm, USER_ID);
        const childRow = list.find(t => t.TopicID === child);
        expect(childRow?.ParentTopicID).toBe(parent);
    });

    it('rejects a parentTopicId belonging to a different user', async () => {
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (9, ?)').run('foreign');
        const stolenParent = await createTopic(dbm, 9, { name: 'TheirRoot', color: '#aaa' });
        await expect(
            createTopic(dbm, USER_ID, { name: 'attempted-child', color: '#bbb', parentTopicId: stolenParent })
        ).rejects.toThrow(/parent/i);
    });

    it('allows parentTopicId = null (root topic)', async () => {
        const id = await createTopic(dbm, USER_ID, { name: 'Root', color: '#abc', parentTopicId: null });
        const list = await listTopics(dbm, USER_ID);
        expect(list.find(t => t.TopicID === id)?.ParentTopicID).toBeNull();
    });
});

describe('moveTopic', () => {
    it('reparents to a sibling', async () => {
        const a = await createTopic(dbm, USER_ID, { name: 'A', color: '#a00' });
        const b = await createTopic(dbm, USER_ID, { name: 'B', color: '#0a0' });
        await moveTopic(dbm, USER_ID, b, a);
        const list = await listTopics(dbm, USER_ID);
        expect(list.find(t => t.TopicID === b)?.ParentTopicID).toBe(a);
    });

    it('refuses to make a topic its own ancestor (cycle guard)', async () => {
        const a = await createTopic(dbm, USER_ID, { name: 'A', color: '#a00' });
        const b = await createTopic(dbm, USER_ID, { name: 'B', color: '#0a0', parentTopicId: a });
        const c = await createTopic(dbm, USER_ID, { name: 'C', color: '#00a', parentTopicId: b });
        // Trying to move A under C would create A → C → B → A cycle.
        await expect(moveTopic(dbm, USER_ID, a, c)).rejects.toThrow(/cycle|ancestor|descendant/i);
    });

    it('refuses to set a topic as its own parent', async () => {
        const a = await createTopic(dbm, USER_ID, { name: 'A', color: '#a00' });
        await expect(moveTopic(dbm, USER_ID, a, a)).rejects.toThrow();
    });

    it('moves to root when parent is null', async () => {
        const a = await createTopic(dbm, USER_ID, { name: 'A', color: '#a00' });
        const b = await createTopic(dbm, USER_ID, { name: 'B', color: '#0a0', parentTopicId: a });
        await moveTopic(dbm, USER_ID, b, null);
        const list = await listTopics(dbm, USER_ID);
        expect(list.find(t => t.TopicID === b)?.ParentTopicID).toBeNull();
    });
});

describe('updateTopic with parent', () => {
    it('changes the parent inline', async () => {
        const a = await createTopic(dbm, USER_ID, { name: 'A', color: '#a00' });
        const b = await createTopic(dbm, USER_ID, { name: 'B', color: '#0a0' });
        await updateTopic(dbm, USER_ID, b, { parentTopicId: a });
        const list = await listTopics(dbm, USER_ID);
        expect(list.find(t => t.TopicID === b)?.ParentTopicID).toBe(a);
    });
});
