/**
 * Feature: Word count goals
 *  - countWords(html) strips tags, splits on whitespace, returns int
 *  - WordGoal table: id, userId, type ('daily'|'total'), target, startDate, endDate, categoryId
 *  - createGoal / getActiveGoals / deleteGoal
 *  - computeProgress({type, target, startDate, endDate, categoryId}, userId) returns
 *    { current, target, percent, wordsToday, wordsTotal }
 *  - Daily goal aggregates words written today (entries created today or modified today)
 *  - Total goal aggregates words across startDate..endDate
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { countWords, createGoal, getActiveGoals, deleteGoal, computeProgress } from '../../src/lib/wordgoals';

const TEST_DB_PATH = join(process.cwd(), `test-goals-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function createEntry(html: string, createdDate?: string): Promise<number> {
    const dateClause = createdDate ? `, CreatedDate` : '';
    const dateValue = createdDate ? `, ?` : '';
    const params: (string | number)[] = [categoryId, 'e', ''];
    if (createdDate) params.push(createdDate);
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText${dateClause}) VALUES (?, ?, ?${dateValue})`
    ).run(...params);
    await dbm.prepare(
        'INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)'
    ).run(r.lastInsertRowid, html);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'wg-user');
    const r = await dbm.prepare(
        'INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)'
    ).run(USER_ID, 'WG', 'Journal');
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
    await dbm.prepare('DELETE FROM WordGoal WHERE UserID = ?').run(USER_ID);
});

describe('Word count', () => {
    it('counts words in plain text', () => {
        expect(countWords('hello world foo')).toBe(3);
        expect(countWords('')).toBe(0);
        expect(countWords('   ')).toBe(0);
    });
    it('strips HTML tags and entities', () => {
        expect(countWords('<p>hello <b>brave</b> new world</p>')).toBe(4);
        expect(countWords('one&nbsp;two')).toBe(2);
        expect(countWords('<h1>title</h1><p>body text here</p>')).toBe(4);
    });
});

describe('WordGoal CRUD', () => {
    it('creates and lists active goals', async () => {
        const id = await createGoal(dbm, USER_ID, {
            type: 'daily',
            target: 500,
            startDate: '2024-01-01',
        });
        const goals = await getActiveGoals(dbm, USER_ID);
        expect(goals.find(g => g.WordGoalID === id)).toBeDefined();
    });

    it('deletes a goal', async () => {
        const id = await createGoal(dbm, USER_ID, { type: 'total', target: 50000, startDate: '2024-11-01', endDate: '2024-11-30' });
        await deleteGoal(dbm, USER_ID, id);
        const goals = await getActiveGoals(dbm, USER_ID);
        expect(goals.find(g => g.WordGoalID === id)).toBeUndefined();
    });
});

describe('Daily goal progress', () => {
    it('sums words written today across all entries', async () => {
        await createEntry('<p>one two three four five</p>'); // 5 words today
        await createEntry('<p>six seven eight</p>');         // 3 words today
        // Old entry shouldn't count toward "today"
        await createEntry('<p>old old old</p>', '2020-01-01 12:00:00');

        const goal = { type: 'daily' as const, target: 100, startDate: '2024-01-01', endDate: null, categoryId: null };
        const progress = await computeProgress(dbm, USER_ID, goal);
        expect(progress.current).toBe(8);
        expect(progress.target).toBe(100);
        expect(progress.percent).toBeCloseTo(8);
    });
});

describe('Total goal progress', () => {
    it('sums words within the date window', async () => {
        await createEntry('<p>aa bb cc</p>', '2024-11-05 12:00:00');
        await createEntry('<p>dd ee</p>', '2024-11-10 12:00:00');
        await createEntry('<p>outside</p>', '2024-12-01 12:00:00');

        const goal = {
            type: 'total' as const, target: 50000,
            startDate: '2024-11-01', endDate: '2024-11-30', categoryId: null,
        };
        const progress = await computeProgress(dbm, USER_ID, goal);
        expect(progress.current).toBe(5);
        expect(progress.percent).toBeCloseTo(5 / 50000 * 100, 4);
    });

    it('respects categoryId filter', async () => {
        const otherCat = await dbm.prepare(
            'INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)'
        ).run(USER_ID, 'Other', 'Journal');
        await createEntry('<p>main words here</p>'); // 3 in our default cat
        await dbm.prepare(
            `INSERT INTO Entry (CategoryID, Title, PreviewText) VALUES (?, ?, ?)`
        ).run(otherCat.lastInsertRowid, 't', '');
        const entryId = (await dbm.prepare('SELECT last_insert_rowid() AS id').get()) as any;
        await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(entryId.id, '<p>other words here</p>');

        const goal = {
            type: 'total' as const, target: 100,
            startDate: '2020-01-01', endDate: null, categoryId,
        };
        const progress = await computeProgress(dbm, USER_ID, goal);
        expect(progress.current).toBe(3);
    });

    it('caps percent at 100', async () => {
        await createEntry('<p>one two three four five six seven eight nine ten</p>');
        const goal = { type: 'total' as const, target: 5, startDate: '2020-01-01', endDate: null, categoryId: null };
        const progress = await computeProgress(dbm, USER_ID, goal);
        expect(progress.percent).toBeLessThanOrEqual(100);
    });
});
