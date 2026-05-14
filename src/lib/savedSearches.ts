import type { DBManager } from './db';

export interface SavedSearch {
    SavedSearchID: number;
    UserID: number;
    Name: string;
    QueryJson: string;
    CreatedAt: string;
}

export async function saveSearch(
    dbm: DBManager,
    userId: number,
    name: string,
    query: Record<string, unknown>
): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO SavedSearch (UserID, Name, QueryJson) VALUES (?, ?, ?)`
    ).run(userId, name, JSON.stringify(query));
    return r.lastInsertRowid;
}

export async function listSavedSearches(dbm: DBManager, userId: number): Promise<SavedSearch[]> {
    return dbm.prepare(
        `SELECT * FROM SavedSearch WHERE UserID = ? ORDER BY CreatedAt DESC`
    ).all(userId) as Promise<SavedSearch[]>;
}

export async function deleteSavedSearch(dbm: DBManager, userId: number, id: number): Promise<void> {
    await dbm.prepare(
        `DELETE FROM SavedSearch WHERE SavedSearchID = ? AND UserID = ?`
    ).run(id, userId);
}
