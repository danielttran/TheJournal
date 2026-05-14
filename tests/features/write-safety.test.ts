/**
 * Mission-critical write safety:
 *  - Entry save uses optimistic locking (Version field). Tested separately.
 *  - New tables (Reminder, WordGoal, SavedSearch, Snippet) don't have version
 *    fields — so we verify "last write wins" is correct (no lost updates,
 *    no corrupted state from concurrent writes).
 *  - Test pattern: trigger N concurrent updates; verify the final state is
 *    exactly one of the inputs (not a torn read).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { createReminder, updateReminder } from '../../src/lib/reminders';
import { createSnippet, updateSnippet } from '../../src/lib/snippets';

const TEST_DB_PATH = join(process.cwd(), `test-write-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'ws');
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare('DELETE FROM Reminder').run();
    await dbm.prepare('DELETE FROM Snippet').run();
});

describe('Reminder concurrent writes — last write wins, no torn state', () => {
    it('20 concurrent updates produce exactly one row with one of the values', async () => {
        const id = await createReminder(dbm, USER_ID, { title: 'init', dueAt: '2026-05-13T00:00:00Z' });

        const writes = Array.from({ length: 20 }, (_, i) =>
            updateReminder(dbm, USER_ID, id, { title: `t${i}`, notes: `n${i}` })
        );
        await Promise.all(writes);

        // Exactly one row
        const count = (await dbm.prepare('SELECT COUNT(*) AS n FROM Reminder').get() as { n: number }).n;
        expect(count).toBe(1);

        // Title and notes must come from the SAME write (no torn state)
        const row = await dbm.prepare('SELECT Title, Notes FROM Reminder WHERE ReminderID = ?').get(id) as { Title: string; Notes: string };
        const titleN = parseInt(row.Title.slice(1), 10);
        const notesN = parseInt(row.Notes.slice(1), 10);
        expect(titleN).toBe(notesN);
    });
});

describe('Snippet concurrent writes', () => {
    it('20 concurrent updates produce exactly one consistent row', async () => {
        const id = await createSnippet(dbm, USER_ID, { name: 'init', content: 'i' });

        const writes = Array.from({ length: 20 }, (_, i) =>
            updateSnippet(dbm, USER_ID, id, { name: `n${i}`, content: `c${i}` })
        );
        await Promise.all(writes);

        const count = (await dbm.prepare('SELECT COUNT(*) AS n FROM Snippet').get() as { n: number }).n;
        expect(count).toBe(1);

        const row = await dbm.prepare('SELECT Name, Content FROM Snippet WHERE SnippetID = ?').get(id) as { Name: string; Content: string };
        const nameN = parseInt(row.Name.slice(1), 10);
        const contentN = parseInt(row.Content.slice(1), 10);
        expect(nameN).toBe(contentN); // same write supplied both fields
    });
});

describe('Concurrent inserts — every one persists, none lost', () => {
    it('50 concurrent createReminder calls produce 50 rows', async () => {
        const promises = Array.from({ length: 50 }, (_, i) =>
            createReminder(dbm, USER_ID, { title: `r${i}`, dueAt: '2026-05-13T00:00:00Z' })
        );
        const ids = await Promise.all(promises);
        const unique = new Set(ids);
        expect(unique.size).toBe(50); // every insert got a unique id

        const count = (await dbm.prepare('SELECT COUNT(*) AS n FROM Reminder').get() as { n: number }).n;
        expect(count).toBe(50);
    });

    it('100 concurrent createSnippet calls produce 100 rows', async () => {
        const promises = Array.from({ length: 100 }, (_, i) =>
            createSnippet(dbm, USER_ID, { name: `s${i}`, content: 'x' })
        );
        await Promise.all(promises);
        const count = (await dbm.prepare('SELECT COUNT(*) AS n FROM Snippet').get() as { n: number }).n;
        expect(count).toBe(100);
    });
});
