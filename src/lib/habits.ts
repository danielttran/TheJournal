import type { DBManager } from './db';

export interface Habit {
    HabitID: number;
    UserID: number;
    Name: string;
    Color: string;
    Goal: number;
    CreatedAt: string;
}

export interface CreateHabitInput {
    name: string;
    color?: string;
    goal?: number;
}

export interface HabitDayStatus { date: string; logged: boolean; }
export interface HabitStreak { current: number; longest: number; }

async function assertHabitOwnership(dbm: DBManager, userId: number, habitId: number): Promise<void> {
    const owns = await dbm.prepare('SELECT 1 FROM Habit WHERE HabitID = ? AND UserID = ?').get(habitId, userId);
    if (!owns) throw new Error('Habit not found or unauthorized');
}

export async function createHabit(dbm: DBManager, userId: number, input: CreateHabitInput): Promise<number> {
    const name = input.name.trim();
    if (!name || name.length > 80) throw new Error('Habit name must be 1-80 chars');
    const r = await dbm.prepare(
        `INSERT INTO Habit (UserID, Name, Color, Goal) VALUES (?, ?, ?, ?)`
    ).run(userId, name, input.color ?? '#10b981', input.goal ?? 1);
    return r.lastInsertRowid;
}

export async function listHabits(dbm: DBManager, userId: number): Promise<Habit[]> {
    return dbm.prepare(`SELECT * FROM Habit WHERE UserID = ? ORDER BY CreatedAt ASC`).all(userId) as Promise<Habit[]>;
}

export async function deleteHabit(dbm: DBManager, userId: number, habitId: number): Promise<void> {
    await dbm.prepare(`DELETE FROM Habit WHERE HabitID = ? AND UserID = ?`).run(habitId, userId);
}

export async function logHabit(dbm: DBManager, userId: number, habitId: number, date: string): Promise<void> {
    await assertHabitOwnership(dbm, userId, habitId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD');
    await dbm.prepare(
        `INSERT OR IGNORE INTO HabitLog (HabitID, Date, Count) VALUES (?, ?, 1)`
    ).run(habitId, date);
}

export async function unlogHabit(dbm: DBManager, userId: number, habitId: number, date: string): Promise<void> {
    await assertHabitOwnership(dbm, userId, habitId);
    await dbm.prepare(`DELETE FROM HabitLog WHERE HabitID = ? AND Date = ?`).run(habitId, date);
}

function eachDay(start: string, end: string): string[] {
    const out: string[] = [];
    const s = new Date(start + 'T00:00:00Z');
    const e = new Date(end + 'T00:00:00Z');
    for (let d = s.getTime(); d <= e.getTime(); d += 86400000) {
        out.push(new Date(d).toISOString().slice(0, 10));
    }
    return out;
}

export async function getHabitStatus(
    dbm: DBManager, userId: number, habitId: number, startDate: string, endDate: string
): Promise<HabitDayStatus[]> {
    await assertHabitOwnership(dbm, userId, habitId);
    const rows = await dbm.prepare(`
        SELECT Date FROM HabitLog WHERE HabitID = ? AND Date BETWEEN ? AND ?
    `).all(habitId, startDate, endDate) as { Date: string }[];
    const set = new Set(rows.map(r => r.Date));
    return eachDay(startDate, endDate).map(date => ({ date, logged: set.has(date) }));
}

export async function habitStreak(dbm: DBManager, userId: number, habitId: number): Promise<HabitStreak> {
    await assertHabitOwnership(dbm, userId, habitId);
    const rows = await dbm.prepare(
        `SELECT Date FROM HabitLog WHERE HabitID = ? ORDER BY Date ASC`
    ).all(habitId) as { Date: string }[];

    if (rows.length === 0) return { current: 0, longest: 0 };

    const dates = rows.map(r => r.Date);
    const set = new Set(dates);

    // Longest streak: walk sorted dates, count consecutive
    let longest = 1, run = 1;
    for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1] + 'T00:00:00Z').getTime();
        const cur = new Date(dates[i] + 'T00:00:00Z').getTime();
        const days = Math.round((cur - prev) / 86400000);
        if (days === 1) { run += 1; longest = Math.max(longest, run); }
        else { run = 1; }
    }

    // Current streak: ends today or yesterday. Habit log dates are stored as the
    // client's LOCAL YYYY-MM-DD, so "today"/"yesterday" must be derived from local
    // calendar components — toISOString() (UTC) lags a day in positive-offset
    // zones and would report a 0 streak for a user who logged today.
    const localYmd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = localYmd(today);
    let cur = todayStr;
    if (!set.has(cur)) {
        const y = new Date(today.getTime() - 86400000);
        const yStr = localYmd(y);
        if (!set.has(yStr)) return { current: 0, longest };
        cur = yStr;
    }
    let current = 0;
    let curDate = new Date(cur + 'T00:00:00Z');
    while (set.has(curDate.toISOString().slice(0, 10))) {
        current += 1;
        curDate = new Date(curDate.getTime() - 86400000);
    }
    return { current, longest };
}
