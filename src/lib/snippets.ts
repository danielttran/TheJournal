import type { DBManager } from './db';

export interface Snippet {
    SnippetID: number;
    UserID: number;
    Name: string;
    Content: string;
    Shortcut: string | null;
    CreatedAt: string;
}

export interface CreateSnippetInput {
    name: string;
    content: string;
    shortcut?: string | null;
}

export interface UpdateSnippetInput {
    name?: string;
    content?: string;
    shortcut?: string | null;
}

async function assertOwnership(dbm: DBManager, userId: number, id: number): Promise<void> {
    const owns = await dbm.prepare(
        'SELECT 1 FROM Snippet WHERE SnippetID = ? AND UserID = ?'
    ).get(id, userId);
    if (!owns) throw new Error('Snippet not found or unauthorized');
}

export async function createSnippet(dbm: DBManager, userId: number, input: CreateSnippetInput): Promise<number> {
    const r = await dbm.prepare(
        `INSERT INTO Snippet (UserID, Name, Content, Shortcut) VALUES (?, ?, ?, ?)`
    ).run(userId, input.name, input.content, input.shortcut ?? null);
    return r.lastInsertRowid;
}

export async function listSnippets(dbm: DBManager, userId: number): Promise<Snippet[]> {
    return dbm.prepare(
        `SELECT * FROM Snippet WHERE UserID = ? ORDER BY Name ASC`
    ).all(userId) as Promise<Snippet[]>;
}

export async function updateSnippet(dbm: DBManager, userId: number, id: number, input: UpdateSnippetInput): Promise<void> {
    await assertOwnership(dbm, userId, id);
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    if (input.name !== undefined) { updates.push('Name = ?'); values.push(input.name); }
    if (input.content !== undefined) { updates.push('Content = ?'); values.push(input.content); }
    if (input.shortcut !== undefined) { updates.push('Shortcut = ?'); values.push(input.shortcut); }
    if (!updates.length) return;
    values.push(id);
    await dbm.prepare(`UPDATE Snippet SET ${updates.join(', ')} WHERE SnippetID = ?`).run(...values);
}

export async function deleteSnippet(dbm: DBManager, userId: number, id: number): Promise<void> {
    await dbm.prepare('DELETE FROM Snippet WHERE SnippetID = ? AND UserID = ?').run(id, userId);
}

export async function findSnippetByShortcut(dbm: DBManager, userId: number, shortcut: string): Promise<Snippet | null> {
    const row = await dbm.prepare(
        `SELECT * FROM Snippet WHERE UserID = ? AND Shortcut = ?`
    ).get(userId, shortcut) as Snippet | undefined;
    return row ?? null;
}
