import type { DBManager } from './db';

const DEFAULT_DATE_FORMAT = 'PP'; // date-fns "Apr 29, 2026"

export async function getSetting(dbm: DBManager, userId: number, key: string): Promise<string | null> {
    const row = await dbm.prepare(
        'SELECT Value FROM UserSetting WHERE UserID = ? AND Key = ?'
    ).get(userId, key) as { Value: string | null } | undefined;
    return row ? row.Value : null;
}

export async function setSetting(dbm: DBManager, userId: number, key: string, value: string): Promise<void> {
    await dbm.prepare(`
        INSERT INTO UserSetting (UserID, Key, Value) VALUES (?, ?, ?)
        ON CONFLICT(UserID, Key) DO UPDATE SET Value = excluded.Value
    `).run(userId, key, value);
}

export async function deleteSetting(dbm: DBManager, userId: number, key: string): Promise<void> {
    await dbm.prepare('DELETE FROM UserSetting WHERE UserID = ? AND Key = ?').run(userId, key);
}

export async function getAllSettings(dbm: DBManager, userId: number): Promise<Record<string, string>> {
    const rows = await dbm.prepare(
        'SELECT Key, Value FROM UserSetting WHERE UserID = ?'
    ).all(userId) as { Key: string; Value: string }[];
    return Object.fromEntries(rows.map(r => [r.Key, r.Value]));
}

/**
 * Validate a date-fns format string at a basic safety level: non-empty,
 * reasonable length, contains at least one date token (digit-letter pattern).
 * We don't run date-fns itself here — that would require a heavier dep at the
 * server boundary. The UI is responsible for previewing and persisting only
 * formats it knows render correctly.
 */
export function validateDateFormat(fmt: string): boolean {
    if (!fmt || !fmt.trim()) return false;
    if (fmt.length > 120) return false;
    // Must contain at least one alpha token (y, M, d, h, H, m, s, P) somewhere
    if (!/[yMdhHmsPpEqQwoBaAtTGRu]/.test(fmt)) return false;
    return true;
}

export async function getDateFormat(dbm: DBManager, userId: number): Promise<string> {
    const stored = await getSetting(dbm, userId, 'dateFormat');
    return stored && validateDateFormat(stored) ? stored : DEFAULT_DATE_FORMAT;
}

export async function setDateFormat(dbm: DBManager, userId: number, fmt: string): Promise<void> {
    if (!validateDateFormat(fmt)) throw new Error('Invalid date format');
    await setSetting(dbm, userId, 'dateFormat', fmt);
}
