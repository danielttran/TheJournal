/**
 * Word-count aggregations (word goals, heatmap, total words) must not count a
 * locked category's ENC1: ciphertext as words. Regression: countWords ran on the
 * raw row, and the base64 ciphertext is one long whitespace-free token → every
 * locked entry counted as ~1 word. They should decrypt when the EEK is cached,
 * and count 0 when it isn't (rather than a bogus 1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { DBManager } from '../../src/lib/db';
import { setCategoryPassword } from '../../src/lib/categoryCrypto';
import { maybeEncryptForCategory } from '../../src/lib/entryEncryption';
import { cacheCategoryKey, clearCategoryKey } from '../../src/lib/categoryKeyCache';
import { computeProgress } from '../../src/lib/wordgoals';
import { totalWords } from '../../src/lib/stats';
import { hourActivity } from '../../src/lib/hourActivity';

const PATH = join(process.cwd(), `test-wclock-${Date.now()}.tjdb`);
const KEY = 'deadbeef'.repeat(8);
let dbm: DBManager;
const USER_ID = 1;
let catId = 0;
let eek: Uint8Array;
const TEN_WORDS = '<p>one two three four five six seven eight nine ten</p>';

const rangeAll = (categoryId: number) => ({
    type: 'total' as const, target: 100, startDate: '2000-01-01', endDate: '2100-01-01', categoryId,
});

beforeAll(async () => {
    dbm = new DBManager(PATH);
    await dbm.unlock(KEY);
    await dbm.prepare('INSERT OR IGNORE INTO User (UserID, Username) VALUES (1, ?)').run('wc');
    const c = await dbm.prepare('INSERT INTO Category (UserID, Name, Type) VALUES (1, ?, ?)').run('Locked', 'Journal');
    catId = c.lastInsertRowid as number;

    // Lock the category and store one entry as ENC1: ciphertext under its EEK.
    eek = await setCategoryPassword(dbm, USER_ID, catId, 'pw');
    cacheCategoryKey(USER_ID, catId, eek);
    const enc = await maybeEncryptForCategory(dbm, USER_ID, catId, TEN_WORDS, null);
    const e = await dbm.prepare('INSERT INTO Entry (CategoryID, Title) VALUES (?, ?)').run(catId, 'locked');
    await dbm.prepare('INSERT INTO EntryContent (EntryID, HtmlContent) VALUES (?, ?)').run(e.lastInsertRowid, enc.html);
});

afterAll(async () => {
    await dbm.close();
    for (const s of ['', '-shm', '-wal']) await unlink(PATH + s).catch(() => {});
});

describe('word counts ignore locked ciphertext', () => {
    it('counts real words when the EEK is cached (unlocked this session)', async () => {
        cacheCategoryKey(USER_ID, catId, eek);
        expect(await totalWords(dbm, USER_ID)).toBe(10);
        expect((await computeProgress(dbm, USER_ID, rangeAll(catId))).current).toBe(10);
        const hours = await hourActivity(dbm, USER_ID, 30);
        expect(hours.reduce((s, b) => s + b.wordCount, 0)).toBe(10);
    });

    it('counts 0 (not ~1) for ciphertext when the EEK is NOT cached (locked)', async () => {
        clearCategoryKey(USER_ID, catId);
        expect(await totalWords(dbm, USER_ID)).toBe(0);
        expect((await computeProgress(dbm, USER_ID, rangeAll(catId))).current).toBe(0);
        const hours = await hourActivity(dbm, USER_ID, 30);
        expect(hours.reduce((s, b) => s + b.wordCount, 0)).toBe(0);
    });
});
