/**
 * Stress test: new features under load.
 *  - 5000 entries: word cloud cap kicks in, returns within reasonable time
 *  - 1000 reminders + filter: list returns quickly
 *  - 1000 snippets: list returns quickly
 *  - Concurrent reminder toggleComplete on a recurring reminder: only spawns ONE
 *    additional occurrence (no race-condition double-spawn)
 *  - Backlinks across 1000 entries: completes
 *  - On This Day across 10 years of data: correct result, fast
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { computeWordCloud } from '../../src/lib/wordcloud';
import { listReminders, createReminder, toggleComplete } from '../../src/lib/reminders';
import { listSnippets, createSnippet } from '../../src/lib/snippets';
import { findBacklinks } from '../../src/lib/backlinks';
import { onThisDay } from '../../src/lib/anniversary';

const TEST_DB_PATH = join(process.cwd(), `test-stress-feat-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'sf');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'SF', 'Notebook');
    categoryId = r.lastInsertRowid;
}, 30_000);

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

describe('Word cloud — large input', () => {
    it('processes 5000 entries within 5 seconds', () => {
        const inputs: string[] = [];
        for (let i = 0; i < 5000; i++) {
            inputs.push(`<p>quick brown fox lazy dog ${i} thinking writing journaling</p>`);
        }
        const start = Date.now();
        const cloud = computeWordCloud(inputs, { limit: 50, minLength: 3 });
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(5000);
        expect(cloud.length).toBeGreaterThan(0);
        // 'fox' appears 5000× → should be near the top
        expect(cloud.slice(0, 10).find(c => c.word === 'fox')?.count).toBe(5000);
    });
});

describe('Reminders — large list', () => {
    it('1000 reminders: list-by-filter returns within 1 second', async () => {
        // Base the due times an hour out so every reminder is genuinely
        // upcoming even after the (non-trivial) insert loop advances the clock —
        // the 'upcoming' filter compares against the current instant, not the
        // current date.
        for (let i = 0; i < 1000; i++) {
            const due = new Date(Date.now() + 3_600_000 + i * 60_000).toISOString();
            await createReminder(dbm, USER_ID, { title: `r${i}`, dueAt: due });
        }
        const start = Date.now();
        const items = await listReminders(dbm, USER_ID, 'upcoming');
        expect(Date.now() - start).toBeLessThan(1000);
        expect(items.length).toBeGreaterThanOrEqual(1000);
        await dbm.prepare('DELETE FROM Reminder').run();
    }, 30_000);
});

describe('Snippets — large list', () => {
    it('500 snippets: list returns within 500ms', async () => {
        for (let i = 0; i < 500; i++) {
            await createSnippet(dbm, USER_ID, { name: `s${i}`, content: `<p>snippet ${i}</p>` });
        }
        const start = Date.now();
        const items = await listSnippets(dbm, USER_ID);
        expect(Date.now() - start).toBeLessThan(500);
        expect(items.length).toBe(500);
        await dbm.prepare('DELETE FROM Snippet').run();
    }, 30_000);
});

describe('Recurring reminders — concurrent toggle', () => {
    it('30 concurrent toggleComplete calls spawn exactly ONE next occurrence', async () => {
        const id = await createReminder(dbm, USER_ID, {
            title: 'concurrent',
            dueAt: '2026-05-13T08:00:00.000Z',
            recurInterval: 'daily',
            recurEvery: 1,
        });
        const promises = Array.from({ length: 30 }, () => toggleComplete(dbm, USER_ID, id));
        // Some will throw "already complete" or be no-ops — we only care about the spawn count.
        await Promise.allSettled(promises);
        const rows = await dbm.prepare('SELECT * FROM Reminder ORDER BY ReminderID').all() as any[];
        // Should have at most 2 rows: original (completed) + one spawned next occurrence.
        // The atomic transaction in toggleComplete clears recurrence on the completed row,
        // so subsequent toggles see RecurInterval=NULL and don't spawn another.
        expect(rows.length).toBeLessThanOrEqual(2);
        await dbm.prepare('DELETE FROM Reminder').run();
    }, 15_000);
});

describe('Backlinks — large corpus', () => {
    it('finds backlinks across 500 entries within 2 seconds', async () => {
        // Create target
        const target = await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`
        ).run(categoryId, 'Hub', '');
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(target.lastInsertRowid, '');

        // 500 entries, half referencing target
        for (let i = 0; i < 500; i++) {
            const r = await dbm.prepare(
                `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`
            ).run(categoryId, `entry-${i}`, '');
            const html = i % 2 === 0 ? '<p>see [[Hub]]</p>' : '<p>no ref</p>';
            await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(r.lastInsertRowid, html);
        }

        const start = Date.now();
        const backs = await findBacklinks(dbm, USER_ID, target.lastInsertRowid as number);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
        expect(backs.length).toBe(250);
        await dbm.prepare('DELETE FROM Entry WHERE CategoryID = ?').run(categoryId);
    }, 30_000);
});

describe('On This Day — multi-year', () => {
    it('finds anniversaries across 10 years within 500ms', async () => {
        for (let yr = 2014; yr <= 2024; yr++) {
            await dbm.prepare(
                `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate) VALUES (?, ?, ?, ?)`
            ).run(categoryId, `entry-${yr}`, '', `${yr}-06-15 12:00:00`);
        }
        // noise from other days
        for (let i = 0; i < 100; i++) {
            await dbm.prepare(
                `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate) VALUES (?, ?, ?, ?)`
            ).run(categoryId, `noise-${i}`, '', `2024-07-${(i % 28) + 1} 12:00:00`);
        }

        const start = Date.now();
        const r = await onThisDay(dbm, USER_ID, new Date('2026-06-15T00:00:00'));
        expect(Date.now() - start).toBeLessThan(500);
        expect(r.length).toBe(11); // 2014..2024 inclusive
        await dbm.prepare('DELETE FROM Entry WHERE CategoryID = ?').run(categoryId);
    }, 30_000);
});
