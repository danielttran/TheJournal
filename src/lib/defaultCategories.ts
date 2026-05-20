import type { DBManager } from './db';

/**
 * Seed a fresh user with the two DavidRM-parity starter categories:
 *
 *   "Daily Journal" (Journal type)   — calendar-style, one entry per date
 *   "Notebook"      (Notebook type)  — loose-leaf hierarchy
 *
 * Idempotent: if the user already owns any category we leave the journal
 * alone. Returns the number of categories actually created (0 or 2).
 *
 * Called from /app/actions.ts after a successful INSERT into User so a
 * brand-new account lands on a usable layout instead of an empty sidebar.
 */

export interface DefaultCategory {
    name: string;
    type: 'Journal' | 'Notebook';
    sortOrder: number;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
    { name: 'Daily Journal', type: 'Journal', sortOrder: 0 },
    { name: 'Notebook', type: 'Notebook', sortOrder: 1 },
];

export async function seedDefaultCategories(
    dbm: DBManager,
    userId: number,
): Promise<number> {
    const existing = await dbm.prepare(
        'SELECT 1 FROM Category WHERE UserID = ? LIMIT 1'
    ).get(userId);
    if (existing) return 0;

    let created = 0;
    for (const cat of DEFAULT_CATEGORIES) {
        await dbm.prepare(
            'INSERT INTO Category (UserID, Name, Type, SortOrder) VALUES (?, ?, ?, ?)'
        ).run(userId, cat.name, cat.type, cat.sortOrder);
        created += 1;
    }
    return created;
}
