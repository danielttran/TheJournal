/**
 * Feature: Snippets
 *  - Snippet table: id, userId, name, content, shortcut (optional), createdAt
 *  - createSnippet / listSnippets / updateSnippet / deleteSnippet
 *  - Authorization: only owner can list/mutate
 *  - findSnippetByShortcut(userId, shortcut) for editor abbreviation expansion
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { createSnippet, listSnippets, updateSnippet, deleteSnippet, findSnippetByShortcut } from '../../src/lib/snippets';

const TEST_DB_PATH = join(process.cwd(), `test-sn-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(1, 'u1');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(2, 'u2');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Snippet').run();
});

describe('Snippets — schema', () => {
    it('Snippet table exists with expected columns', async () => {
        const cols = await dbm.prepare(`PRAGMA table_info(Snippet)`).all() as { name: string }[];
        const names = new Set(cols.map(c => c.name));
        for (const c of ['SnippetID', 'UserID', 'Name', 'Content', 'Shortcut', 'CreatedAt']) {
            expect(names.has(c), `missing ${c}`).toBe(true);
        }
    });
});

describe('Snippets — CRUD', () => {
    it('creates, lists, updates, deletes', async () => {
        const id = await createSnippet(dbm, 1, { name: 'Greeting', content: '<p>Hi!</p>', shortcut: ';hi' });
        let list = await listSnippets(dbm, 1);
        expect(list.length).toBe(1);
        expect(list[0].Name).toBe('Greeting');
        expect(list[0].Shortcut).toBe(';hi');

        await updateSnippet(dbm, 1, id, { name: 'Updated', content: '<p>updated</p>' });
        list = await listSnippets(dbm, 1);
        expect(list[0].Name).toBe('Updated');

        await deleteSnippet(dbm, 1, id);
        expect((await listSnippets(dbm, 1)).length).toBe(0);
    });

    it('refuses cross-user updates and deletes', async () => {
        const id = await createSnippet(dbm, 1, { name: 'mine', content: 'x' });
        await expect(updateSnippet(dbm, 2, id, { name: 'pwn' })).rejects.toThrow();
        await deleteSnippet(dbm, 2, id);
        expect((await listSnippets(dbm, 1)).length).toBe(1);
    });
});

describe('Snippets — shortcut lookup', () => {
    it('returns matching snippet for user + shortcut', async () => {
        await createSnippet(dbm, 1, { name: 'A', content: 'aaa', shortcut: ';a' });
        await createSnippet(dbm, 1, { name: 'B', content: 'bbb', shortcut: ';b' });
        const got = await findSnippetByShortcut(dbm, 1, ';a');
        expect(got?.Content).toBe('aaa');
    });

    it('returns null when no shortcut matches', async () => {
        await createSnippet(dbm, 1, { name: 'A', content: 'aaa', shortcut: ';a' });
        expect(await findSnippetByShortcut(dbm, 1, ';z')).toBeNull();
    });

    it('does not match another user\'s shortcut', async () => {
        await createSnippet(dbm, 1, { name: 'A', content: 'aaa', shortcut: ';shared' });
        expect(await findSnippetByShortcut(dbm, 2, ';shared')).toBeNull();
    });
});
