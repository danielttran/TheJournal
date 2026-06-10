/**
 * Drift guard for backup/restore fidelity.
 *
 * Restore silently dropping a table is a permanent-data-loss bug (it happened
 * with per-category passwords and ParentCategoryID). This test fails if a
 * user-owned table exists in the schema but the importer never references it,
 * forcing whoever adds a table to also teach restore about it.
 *
 * The guard is also COLUMN-level: a new column on a user-owned table that the
 * importer's explicit column lists don't mention is silently dropped on
 * restore (it happened with Category.WeekStartDay) — table-level coverage
 * alone can't catch that.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { DBManager } from '../../src/lib/db';

const importSrc = readFileSync(
    join(process.cwd(), 'src/app/api/backup/import/route.ts'), 'utf8',
);

// Every table that holds per-user data and therefore must round-trip through a
// restore. User (accounts) and EntrySearch (FTS, auto-rebuilt) are excluded.
const USER_OWNED_TABLES = [
    'Category', 'Entry', 'EntryContent', 'Attachment',
    'Template', 'Snippet', 'Topic', 'EntryTopic',
    'Habit', 'HabitLog', 'Reminder', 'WordGoal', 'SavedSearch',
    'UserSetting', 'BackupSchedule',
];

const TEST_DB_PATH = join(process.cwd(), `test-import-cov-${Date.now()}.tjdb`);
let dbm: DBManager;

beforeAll(async () => {
    dbm = new DBManager(TEST_DB_PATH);
    await dbm.unlock('deadbeef'.repeat(8));
});

afterAll(async () => {
    await dbm.close();
    for (const suffix of ['', '-shm', '-wal']) {
        await unlink(TEST_DB_PATH + suffix).catch(() => {});
    }
});

describe('backup importer table coverage', () => {
    it.each(USER_OWNED_TABLES)('restores the %s table', (table) => {
        expect(importSrc).toContain(`imported.${table}`);
        expect(importSrc).toContain(`main.${table}`);
    });

    // Columns the importer legitimately does NOT carry over. Every entry here
    // needs a reason — anything else missing fails the guard.
    const EXCLUDED_COLUMNS = new Set([
        // Optimistic-concurrency counter; restored rows are fresh, version 1.
        'Entry.Version',
        // Standalone primary keys with no table referencing them — rows get
        // fresh ids on insert. (ReminderID IS referenced: NextOccurrenceID.)
        'Snippet.SnippetID', 'WordGoal.WordGoalID', 'SavedSearch.SavedSearchID',
        'BackupSchedule.BackupScheduleID',
    ]);

    it.each(USER_OWNED_TABLES)('references every live %s column (column-level drift guard)', async (table) => {
        const cols = await dbm.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
        const missing = cols
            .map(c => c.name)
            .filter(name => !EXCLUDED_COLUMNS.has(`${table}.${name}`))
            .filter(name => !importSrc.includes(name));
        expect(missing, `importer never mentions ${table} column(s): ${missing.join(', ')} — restore would drop them`).toEqual([]);
    });

    it('restores per-category password material (locked entries stay decryptable)', () => {
        for (const col of ['PasswordHash', 'PasswordSalt', 'PasswordWrappedKey']) {
            expect(importSrc).toContain(col);
        }
    });

    it('validates the file before the destructive delete', () => {
        // The "not a valid backup" guard must appear so a foreign file can't wipe data.
        expect(importSrc).toMatch(/not a valid TheJournal backup/i);
    });
});
