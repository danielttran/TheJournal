/**
 * Year-at-a-glance heatmap.
 *  - buildHeatmap(dbm, userId, year) returns 365 or 366 entries (one per day)
 *  - Each cell: { date, entryCount, wordCount, intensity 0..4 }
 *  - Includes Feb 29 for leap years
 *  - Excludes soft-deleted entries
 *  - Scoped to user
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { buildHeatmap } from '../../src/lib/heatmap';

const TEST_DB_PATH = join(process.cwd(), `test-heat-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function entry(createdDate: string, html: string): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate) VALUES (?, 't', '', ?)`
    ).run(categoryId, createdDate);
    await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(r.lastInsertRowid, html);
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'h');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'H', 'Journal');
    categoryId = r.lastInsertRowid;
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

beforeEach(async () => {
    await dbm.prepare(`DELETE FROM Entry WHERE CategoryID = ?`).run(categoryId);
});

describe('buildHeatmap', () => {
    it('returns 365 cells for a non-leap year', async () => {
        const cells = await buildHeatmap(dbm, USER_ID, 2025);
        expect(cells.length).toBe(365);
    });

    it('returns 366 cells for a leap year', async () => {
        const cells = await buildHeatmap(dbm, USER_ID, 2024);
        expect(cells.length).toBe(366);
        expect(cells.find(c => c.date === '2024-02-29')).toBeDefined();
    });

    it('counts entries and words per day', async () => {
        await entry('2024-06-15 09:00:00', '<p>one two three</p>');
        await entry('2024-06-15 22:00:00', '<p>four five</p>');
        await entry('2024-06-16 10:00:00', '<p>six</p>');

        const cells = await buildHeatmap(dbm, USER_ID, 2024);
        const day15 = cells.find(c => c.date === '2024-06-15')!;
        const day16 = cells.find(c => c.date === '2024-06-16')!;
        const day17 = cells.find(c => c.date === '2024-06-17')!;

        expect(day15.entryCount).toBe(2);
        expect(day15.wordCount).toBe(5);
        expect(day16.entryCount).toBe(1);
        expect(day16.wordCount).toBe(1);
        expect(day17.entryCount).toBe(0);
        expect(day17.wordCount).toBe(0);
    });

    it('computes intensity 0..4 based on word-count quartiles', async () => {
        // Mix of zero / low / high days
        await entry('2024-01-01 12:00:00', '<p>one</p>');           // 1 word
        await entry('2024-01-02 12:00:00', '<p>one two three four</p>'); // 4 words
        await entry('2024-01-03 12:00:00', '<p>' + 'word '.repeat(50) + '</p>'); // 50

        const cells = await buildHeatmap(dbm, USER_ID, 2024);
        const day1 = cells.find(c => c.date === '2024-01-01')!;
        const day2 = cells.find(c => c.date === '2024-01-02')!;
        const day3 = cells.find(c => c.date === '2024-01-03')!;
        const empty = cells.find(c => c.date === '2024-01-04')!;

        expect(empty.intensity).toBe(0);
        // Each populated day has intensity >= 1
        expect(day1.intensity).toBeGreaterThanOrEqual(1);
        expect(day2.intensity).toBeGreaterThanOrEqual(1);
        expect(day3.intensity).toBeGreaterThanOrEqual(1);
        // The biggest day caps at 4
        expect(day3.intensity).toBeLessThanOrEqual(4);
        // The biggest day has the highest intensity
        expect(day3.intensity).toBeGreaterThanOrEqual(day1.intensity);
    });

    it('excludes soft-deleted entries', async () => {
        const id = await entry('2024-05-13 12:00:00', '<p>secret</p>');
        await dbm.prepare(`UPDATE Entry SET IsDeleted = 1 WHERE EntryID = ?`).run(id);
        const cells = await buildHeatmap(dbm, USER_ID, 2024);
        expect(cells.find(c => c.date === '2024-05-13')!.entryCount).toBe(0);
    });

    it('scoped to user', async () => {
        await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(99, 'o');
        const otherCat = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(99, 'OC', 'Journal');
        await dbm.prepare(`INSERT INTO Entry (CategoryID, Title, PreviewText, CreatedDate) VALUES (?, 'x', '', '2024-03-01 12:00:00')`).run(otherCat.lastInsertRowid);

        const cells = await buildHeatmap(dbm, USER_ID, 2024);
        expect(cells.find(c => c.date === '2024-03-01')!.entryCount).toBe(0);
    });
});
