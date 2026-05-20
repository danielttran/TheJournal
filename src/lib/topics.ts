import type { DBManager } from './db';

export interface Topic {
    TopicID: number;
    UserID: number;
    Name: string;
    Color: string;
    Hotkey: number | null;
    SortOrder: number;
    CreatedAt: string;
    ParentTopicID: number | null;
}

export interface CreateTopicInput {
    name: string;
    color: string;
    hotkey?: number | null;
    sortOrder?: number;
    parentTopicId?: number | null;
}

export interface UpdateTopicInput {
    name?: string;
    color?: string;
    hotkey?: number | null;
    sortOrder?: number;
    parentTopicId?: number | null;
}

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isValidHexColor(s: string): boolean {
    return typeof s === 'string' && HEX_COLOR_RE.test(s);
}

function validateInput(input: { name?: string; color?: string; hotkey?: number | null }): void {
    if (input.name !== undefined) {
        const n = input.name.trim();
        if (!n || n.length > 60) throw new Error('Topic name must be 1-60 chars');
    }
    if (input.color !== undefined && !isValidHexColor(input.color)) {
        throw new Error('Topic color must be a valid hex color');
    }
    if (input.hotkey !== undefined && input.hotkey !== null) {
        if (!Number.isInteger(input.hotkey) || input.hotkey < 0 || input.hotkey > 9) {
            throw new Error('Topic hotkey must be 0-9');
        }
    }
}

export async function createTopic(dbm: DBManager, userId: number, input: CreateTopicInput): Promise<number> {
    validateInput(input);

    // Case-insensitive uniqueness check (SQLite default UNIQUE is case-sensitive)
    const nameClash = await dbm.prepare(
        `SELECT TopicID FROM Topic WHERE UserID = ? AND LOWER(Name) = LOWER(?)`
    ).get(userId, input.name.trim());
    if (nameClash) throw new Error('Topic name already exists');

    if (input.hotkey != null) {
        const existing = await dbm.prepare(
            `SELECT TopicID FROM Topic WHERE UserID = ? AND Hotkey = ?`
        ).get(userId, input.hotkey);
        if (existing) throw new Error(`Hotkey ${input.hotkey} already in use`);
    }

    if (input.parentTopicId != null) {
        const ownsParent = await dbm.prepare(
            'SELECT 1 FROM Topic WHERE TopicID = ? AND UserID = ?'
        ).get(input.parentTopicId, userId);
        if (!ownsParent) throw new Error('Parent topic not found or unauthorized');
    }

    try {
        const r = await dbm.prepare(`
            INSERT INTO Topic (UserID, Name, Color, Hotkey, SortOrder, ParentTopicID)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            userId, input.name.trim(), input.color, input.hotkey ?? null,
            input.sortOrder ?? 0, input.parentTopicId ?? null,
        );
        return r.lastInsertRowid;
    } catch (err) {
        // UNIQUE(UserID, Name) violation → friendlier error
        const message = err instanceof Error ? err.message : String(err);
        if (/UNIQUE/i.test(message)) {
            throw new Error('Topic name already exists');
        }
        throw err;
    }
}

export async function listTopics(dbm: DBManager, userId: number): Promise<Topic[]> {
    return dbm.prepare(
        `SELECT * FROM Topic WHERE UserID = ? ORDER BY SortOrder ASC, Name ASC`
    ).all(userId) as Promise<Topic[]>;
}

async function assertTopicOwnership(dbm: DBManager, userId: number, topicId: number): Promise<void> {
    const owns = await dbm.prepare('SELECT 1 FROM Topic WHERE TopicID = ? AND UserID = ?').get(topicId, userId);
    if (!owns) throw new Error('Topic not found or unauthorized');
}

async function assertEntryOwnership(dbm: DBManager, userId: number, entryId: number): Promise<void> {
    const owns = await dbm.prepare(`
        SELECT 1 FROM Entry e
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE e.EntryID = ? AND c.UserID = ?
    `).get(entryId, userId);
    if (!owns) throw new Error('Entry not found or unauthorized');
}

export async function updateTopic(dbm: DBManager, userId: number, topicId: number, input: UpdateTopicInput): Promise<void> {
    await assertTopicOwnership(dbm, userId, topicId);
    validateInput(input);

    if (input.hotkey != null) {
        const conflict = await dbm.prepare(
            `SELECT TopicID FROM Topic WHERE UserID = ? AND Hotkey = ? AND TopicID <> ?`
        ).get(userId, input.hotkey, topicId);
        if (conflict) throw new Error(`Hotkey ${input.hotkey} already in use`);
    }

    // Reparenting through updateTopic delegates to moveTopic so the cycle
    // guard is applied even when the caller drives the change via UPDATE.
    if (input.parentTopicId !== undefined) {
        await moveTopic(dbm, userId, topicId, input.parentTopicId);
    }

    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if (input.name !== undefined) { sets.push('Name = ?'); vals.push(input.name.trim()); }
    if (input.color !== undefined) { sets.push('Color = ?'); vals.push(input.color); }
    if (input.hotkey !== undefined) { sets.push('Hotkey = ?'); vals.push(input.hotkey); }
    if (input.sortOrder !== undefined) { sets.push('SortOrder = ?'); vals.push(input.sortOrder); }
    if (!sets.length) return;
    vals.push(topicId);
    await dbm.prepare(`UPDATE Topic SET ${sets.join(', ')} WHERE TopicID = ?`).run(...vals);
}

/**
 * Reparent a topic. parentTopicId=null moves it to the root.
 *
 * Cycle guard: walks up from the proposed parent and refuses if the topic
 * itself appears in the ancestor chain. Mirrors the cycle guard used for
 * Entry parent moves.
 */
export async function moveTopic(
    dbm: DBManager,
    userId: number,
    topicId: number,
    parentTopicId: number | null,
): Promise<void> {
    await assertTopicOwnership(dbm, userId, topicId);

    if (parentTopicId === topicId) {
        throw new Error('A topic cannot be its own parent');
    }

    if (parentTopicId != null) {
        await assertTopicOwnership(dbm, userId, parentTopicId);
        // Walk up from parentTopicId — if we reach topicId we'd form a cycle.
        let cursor: number | null = parentTopicId;
        const seen = new Set<number>();
        while (cursor != null) {
            if (seen.has(cursor)) break; // safety net for pre-existing cycles
            seen.add(cursor);
            if (cursor === topicId) {
                throw new Error('Cannot move topic — would form a cycle (descendant of itself)');
            }
            const row = await dbm.prepare(
                'SELECT ParentTopicID FROM Topic WHERE TopicID = ? AND UserID = ?'
            ).get(cursor, userId) as { ParentTopicID: number | null } | undefined;
            cursor = row?.ParentTopicID ?? null;
        }
    }

    await dbm.prepare(
        'UPDATE Topic SET ParentTopicID = ? WHERE TopicID = ? AND UserID = ?'
    ).run(parentTopicId, topicId, userId);
}

export async function deleteTopic(dbm: DBManager, userId: number, topicId: number): Promise<void> {
    await dbm.prepare('DELETE FROM Topic WHERE TopicID = ? AND UserID = ?').run(topicId, userId);
}

export async function assignTopic(dbm: DBManager, userId: number, entryId: number, topicId: number): Promise<void> {
    await assertEntryOwnership(dbm, userId, entryId);
    await assertTopicOwnership(dbm, userId, topicId);
    await dbm.prepare(`INSERT OR IGNORE INTO EntryTopic (EntryID, TopicID) VALUES (?, ?)`).run(entryId, topicId);
}

export async function unassignTopic(dbm: DBManager, userId: number, entryId: number, topicId: number): Promise<void> {
    await assertEntryOwnership(dbm, userId, entryId);
    await dbm.prepare(`DELETE FROM EntryTopic WHERE EntryID = ? AND TopicID = ?`).run(entryId, topicId);
}

export async function topicsForEntry(dbm: DBManager, userId: number, entryId: number): Promise<Topic[]> {
    return dbm.prepare(`
        SELECT t.* FROM EntryTopic et
        JOIN Topic t ON et.TopicID = t.TopicID
        WHERE et.EntryID = ? AND t.UserID = ?
        ORDER BY t.SortOrder ASC, t.Name ASC
    `).all(entryId, userId) as Promise<Topic[]>;
}

export interface EntrySummary {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CreatedDate: string;
}

export async function entriesForTopic(dbm: DBManager, userId: number, topicId: number): Promise<EntrySummary[]> {
    return dbm.prepare(`
        SELECT e.EntryID, e.Title, e.CategoryID, e.CreatedDate
        FROM EntryTopic et
        JOIN Entry e ON e.EntryID = et.EntryID
        JOIN Category c ON e.CategoryID = c.CategoryID
        WHERE et.TopicID = ? AND c.UserID = ? AND e.IsDeleted = 0
        ORDER BY e.CreatedDate DESC
    `).all(topicId, userId) as Promise<EntrySummary[]>;
}
