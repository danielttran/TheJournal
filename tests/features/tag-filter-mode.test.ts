/**
 * Tag filter mode: 'all' (AND) vs 'any' (OR).
 * Builds on the existing tags test suite; here we cover only the mode flag.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { filterEntriesByTags } from '../../src/lib/tags';

const TEST_DB_PATH = join(process.cwd(), `test-tag-mode-${Date.now()}.tjdb`);
const TEST_KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let categoryId: number;

async function entry(tags: string[]): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Entry (CategoryID, Title, PreviewText, Tags) VALUES (?, ?, ?, ?)`
    ).run(categoryId, 't', '', JSON.stringify(tags));
    return r.lastInsertRowid;
}

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock(TEST_KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (?, ?)').run(USER_ID, 'tm');
    const r = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (?, ?, ?)').run(USER_ID, 'TM', 'Notebook');
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

describe('filterEntriesByTags mode', () => {
    it("'all' returns entries with EVERY requested tag (default)", async () => {
        const a = await entry(['work', 'travel']);
        await entry(['work']);
        await entry(['travel']);
        const ids = await filterEntriesByTags(dbm, USER_ID, ['work', 'travel']);
        expect(ids).toEqual([a]);
    });

    it("'any' returns entries with AT LEAST ONE requested tag", async () => {
        const a = await entry(['work', 'travel']);
        const b = await entry(['work']);
        const c = await entry(['travel']);
        await entry(['food']);
        const ids = await filterEntriesByTags(dbm, USER_ID, ['work', 'travel'], undefined, 'any');
        expect(ids.sort()).toEqual([a, b, c].sort());
    });

    it("'all' with a single tag matches that tag", async () => {
        const a = await entry(['work']);
        const ids = await filterEntriesByTags(dbm, USER_ID, ['work'], undefined, 'all');
        expect(ids).toEqual([a]);
    });

    it("'any' is case-insensitive", async () => {
        const a = await entry(['Work']);
        const ids = await filterEntriesByTags(dbm, USER_ID, ['WORK'], undefined, 'any');
        expect(ids).toEqual([a]);
    });
});
