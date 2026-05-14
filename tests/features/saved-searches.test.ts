/**
 * Feature: Saved searches
 *  - SavedSearch table already created in db.ts migration
 *  - saveSearch / listSavedSearches / deleteSavedSearch
 *  - Authorization: only owning user can list / delete
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { saveSearch, listSavedSearches, deleteSavedSearch } from '../../src/lib/savedSearches';

const TEST_DB_PATH = join(process.cwd(), `test-ss-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(1, 'a');
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(2, 'b');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM SavedSearch').run();
});

describe('Saved searches', () => {
    it('saves and lists searches', async () => {
        const id = await saveSearch(dbm, 1, 'My search', { q: 'foo', matchCase: true });
        expect(id).toBeGreaterThan(0);
        const list = await listSavedSearches(dbm, 1);
        expect(list.length).toBe(1);
        expect(list[0].Name).toBe('My search');
        expect(JSON.parse(list[0].QueryJson)).toEqual({ q: 'foo', matchCase: true });
    });

    it('deletes a saved search', async () => {
        const id = await saveSearch(dbm, 1, 'x', { q: 'a' });
        await deleteSavedSearch(dbm, 1, id);
        const list = await listSavedSearches(dbm, 1);
        expect(list.length).toBe(0);
    });

    it('refuses to delete another user\'s saved search', async () => {
        const id = await saveSearch(dbm, 1, 'mine', { q: 'a' });
        await deleteSavedSearch(dbm, 2, id);
        const list = await listSavedSearches(dbm, 1);
        expect(list.length).toBe(1); // still there
    });

    it('only lists searches owned by the user', async () => {
        await saveSearch(dbm, 1, 'mine', { q: 'a' });
        await saveSearch(dbm, 2, 'theirs', { q: 'b' });
        const list = await listSavedSearches(dbm, 1);
        expect(list.length).toBe(1);
        expect(list[0].Name).toBe('mine');
    });
});
