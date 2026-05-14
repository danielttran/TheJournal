/**
 * Mission-critical engine guarantees:
 *  1. Cold-worker safety — every lib function works on a fresh DBManager that has
 *     never been unlocked. The lazy unlock fires automatically.
 *  2. Transaction atomicity — on throw, all writes inside the transaction roll
 *     back, the mutex is released, and the next transaction proceeds normally.
 *  3. Concurrent transaction serialization — mutex prevents BEGIN-inside-BEGIN.
 *  4. Direct dbManager.prepare also lazy-unlocks (parity with `db` proxy).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager, db } from '../../src/lib/db';
import { createReminder, listReminders } from '../../src/lib/reminders';
import { createSnippet, listSnippets } from '../../src/lib/snippets';
import { listDistinctTags } from '../../src/lib/tags';
import { onThisDay } from '../../src/lib/anniversary';
import { findBacklinks } from '../../src/lib/backlinks';

const TEST_DB_PATH = join(process.cwd(), `test-engine-${Date.now()}.tjdb`);

beforeAll(async () => {
    process.env.JOURNAL_DB_PATH = TEST_DB_PATH;
});

afterAll(async () => {
    // Use the lazy DBManager through `db` proxy for cleanup — same path users hit
    await db.close();
    delete process.env.JOURNAL_DB_PATH;
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

describe('Cold-worker safety: every lib function lazy-unlocks', () => {
    /**
     * Each test below force-closes the connection first, then calls a lib
     * function. If the function correctly lazy-unlocks, the call succeeds.
     * If it still throws DatabaseNotUnlockedError, the test fails.
     */
    let userId: number;
    let categoryId: number;
    let testDbm: DBManager;

    beforeAll(async () => {
        // Use a fresh DBManager so tests don't share state with other suites
        testDbm = new DBManager(TEST_DB_PATH);
        await testDbm.unlock('deadbeef'.repeat(8));
        await testDbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(1, 'engine');
        const c = await testDbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(1, 'EC', 'Notebook');
        userId = 1;
        categoryId = c.lastInsertRowid;
    });

    beforeEach(async () => {
        await testDbm.prepare('DELETE FROM Reminder').run();
        await testDbm.prepare('DELETE FROM Snippet').run();
        await testDbm.prepare(`DELETE FROM Entry WHERE CategoryID = ?`).run(categoryId);
    });

    it('createReminder + listReminders work on a freshly-closed connection', async () => {
        await testDbm.close();
        expect(testDbm.instance).toBeNull();

        // No explicit unlock — the lib function must self-unlock
        const id = await createReminder(testDbm, userId, { title: 'cold', dueAt: new Date().toISOString() });
        expect(id).toBeGreaterThan(0);
        expect(testDbm.instance).not.toBeNull();

        const items = await listReminders(testDbm, userId, 'all');
        expect(items.length).toBe(1);
    });

    it('createSnippet + listSnippets on a cold connection', async () => {
        await testDbm.close();
        const id = await createSnippet(testDbm, userId, { name: 'sig', content: '<p>—me</p>' });
        expect(id).toBeGreaterThan(0);
        const list = await listSnippets(testDbm, userId);
        expect(list.length).toBe(1);
    });

    it('listDistinctTags on a cold connection', async () => {
        // Seed first while unlocked
        await testDbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, Tags) VALUES (?, ?, ?, ?)`
        ).run(categoryId, 'x', '', JSON.stringify(['cold']));
        await testDbm.close();

        const tags = await listDistinctTags(testDbm, userId);
        expect(tags.find(t => t.tag === 'cold')).toBeDefined();
    });

    it('onThisDay on a cold connection', async () => {
        await testDbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate) VALUES (?, ?, ?, ?)`
        ).run(categoryId, 'past', '', '2020-05-13 12:00:00');
        await testDbm.close();

        const r = await onThisDay(testDbm, userId, new Date('2026-05-13T12:00:00'));
        expect(r.length).toBe(1);
        expect(r[0].Title).toBe('past');
    });

    it('findBacklinks on a cold connection', async () => {
        const target = await testDbm.prepare('INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)').run(categoryId, 'Hub', '');
        await testDbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(target.lastInsertRowid, '');
        const ref = await testDbm.prepare('INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)').run(categoryId, 'Ref', '');
        await testDbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(ref.lastInsertRowid, '<p>[[Hub]]</p>');
        await testDbm.close();

        const backs = await findBacklinks(testDbm, userId, target.lastInsertRowid as number);
        expect(backs.map(b => b.EntryID)).toEqual([ref.lastInsertRowid]);
    });
});

describe('Transaction atomicity + rollback', () => {
    let dbm: DBManager;

    beforeAll(async () => {
        dbm = new DBManager(TEST_DB_PATH);
        await dbm.unlock('deadbeef'.repeat(8));
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(1, 'tx');
        const c = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(1, 'TX', 'Notebook');
        await dbm.prepare('INSERT INTO Entry (EntryID, CategoryID, Title, PreviewText) VALUES (?, ?, ?, ?)').run(9999, c.lastInsertRowid, 'baseline', '');
    });

    afterAll(async () => {
        await dbm.close();
    });

    it('throw inside transaction rolls back all writes', async () => {
        const before = await dbm.prepare('SELECT COUNT(*) AS n FROM Reminder').get() as { n: number };

        const tx = dbm.transaction(async () => {
            await dbm.prepare('INSERT INTO Reminder (UserID, Title, DueAt) VALUES (?, ?, ?)').run(1, 'a', '2026-05-13T00:00:00Z');
            await dbm.prepare('INSERT INTO Reminder (UserID, Title, DueAt) VALUES (?, ?, ?)').run(1, 'b', '2026-05-13T00:00:00Z');
            throw new Error('boom');
        });

        await expect(tx()).rejects.toThrow('boom');

        const after = await dbm.prepare('SELECT COUNT(*) AS n FROM Reminder').get() as { n: number };
        expect(after.n).toBe(before.n); // Nothing inserted
    });

    it('mutex is released after a failed transaction — next transaction proceeds', async () => {
        // First transaction fails
        const failingTx = dbm.transaction(async () => { throw new Error('fail'); });
        await expect(failingTx()).rejects.toThrow();

        // Second transaction succeeds — mutex must be released
        const okTx = dbm.transaction(async () => {
            await dbm.prepare('INSERT INTO Reminder (UserID, Title, DueAt) VALUES (?, ?, ?)').run(1, 'after-fail', '2026-05-13T00:00:00Z');
        });
        await okTx();

        const row = await dbm.prepare('SELECT Title FROM Reminder WHERE Title = ?').get('after-fail') as { Title: string } | undefined;
        expect(row?.Title).toBe('after-fail');
    });

    it('30 concurrent transactions serialize (no BEGIN-inside-BEGIN)', async () => {
        await dbm.prepare('DELETE FROM Reminder').run();
        const promises = Array.from({ length: 30 }, (_, i) =>
            dbm.transaction(async () => {
                await dbm.prepare('INSERT INTO Reminder (UserID, Title, DueAt) VALUES (?, ?, ?)').run(1, `r${i}`, '2026-05-13T00:00:00Z');
            })()
        );
        await Promise.all(promises);

        const n = (await dbm.prepare('SELECT COUNT(*) AS n FROM Reminder').get() as { n: number }).n;
        expect(n).toBe(30);
    });
});
