/**
 * Drift guard for backup/restore fidelity.
 *
 * Restore silently dropping a table is a permanent-data-loss bug (it happened
 * with per-category passwords and ParentCategoryID). This test fails if a
 * user-owned table exists in the schema but the importer never references it,
 * forcing whoever adds a table to also teach restore about it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

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

describe('backup importer table coverage', () => {
    it.each(USER_OWNED_TABLES)('restores the %s table', (table) => {
        expect(importSrc).toContain(`imported.${table}`);
        expect(importSrc).toContain(`main.${table}`);
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
