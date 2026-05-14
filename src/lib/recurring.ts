export type RecurInterval = 'daily' | 'weekly' | 'monthly' | 'yearly';

function isLeapYear(y: number): boolean {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function daysInMonth(y: number, m: number /* 0-indexed */): number {
    return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
}

/**
 * Add `every` units of `interval` to `from`. Returns ISO 8601 string in UTC.
 * Monthly + yearly clamp the day-of-month to the last day of the target month
 * (so Jan 31 + 1 month = Feb 28 / 29, Feb 29 + 1 year = Feb 28 in non-leap years).
 */
export function advanceDueAt(from: string, interval: RecurInterval, every: number): string {
    const d = new Date(from);
    if (interval === 'daily') {
        d.setUTCDate(d.getUTCDate() + every);
    } else if (interval === 'weekly') {
        d.setUTCDate(d.getUTCDate() + 7 * every);
    } else if (interval === 'monthly') {
        const targetMonth = d.getUTCMonth() + every;
        const yearDelta = Math.floor(targetMonth / 12);
        const newMonth = ((targetMonth % 12) + 12) % 12;
        const newYear = d.getUTCFullYear() + yearDelta;
        const maxDay = daysInMonth(newYear, newMonth);
        const day = Math.min(d.getUTCDate(), maxDay);
        d.setUTCFullYear(newYear, newMonth, day);
    } else if (interval === 'yearly') {
        const newYear = d.getUTCFullYear() + every;
        const maxDay = daysInMonth(newYear, d.getUTCMonth());
        const day = Math.min(d.getUTCDate(), maxDay);
        d.setUTCFullYear(newYear, d.getUTCMonth(), day);
    }
    return d.toISOString();
}
