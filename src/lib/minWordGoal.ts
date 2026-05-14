import type { DBManager } from './db';
import { countWords } from './wordgoals';
import { getSetting, setSetting } from './settings';

export interface MinWordCheck {
    meets: boolean;
    count: number;
    min: number;
}

const MAX_MIN = 1_000_000; // sanity cap

export function checkWordMinimum(html: string | null | undefined, min: number): MinWordCheck {
    const safe = Number.isFinite(min) && min >= 0 ? Math.floor(min) : 0;
    if (safe === 0) return { meets: true, count: countWords(html ?? ''), min: 0 };
    const count = countWords(html ?? '');
    return { meets: count >= safe, count, min: safe };
}

export async function getMinWordGoal(dbm: DBManager, userId: number): Promise<number> {
    const v = await getSetting(dbm, userId, 'minWordsPerEntry');
    if (v == null) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function setMinWordGoal(dbm: DBManager, userId: number, n: number): Promise<void> {
    if (!Number.isFinite(n) || n < 0) throw new Error('Min word goal must be a non-negative integer');
    if (n > MAX_MIN) throw new Error(`Min word goal cannot exceed ${MAX_MIN}`);
    await setSetting(dbm, userId, 'minWordsPerEntry', String(Math.floor(n)));
}
