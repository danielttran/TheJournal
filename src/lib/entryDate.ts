/**
 * J8 "change entry date": normalize a user-supplied redate payload to the DB's
 * 'YYYY-MM-DD HH:MM:SS'. Accepts YYYY-MM-DD (stored at noon, matching the
 * by-date route's timezone-safe convention) or a full timestamp with optional
 * seconds. Returns null when the shape is wrong or the date is impossible
 * (month 13, Feb 30, …).
 */
export const CREATED_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;

export function normalizeCreatedDate(raw: string): string | null {
    if (!CREATED_DATE_SHAPE.test(raw)) return null;
    let full = raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) full = `${raw} 12:00:00`;
    else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw)) full = `${raw}:00`;
    const probe = new Date(full.replace(' ', 'T'));
    if (Number.isNaN(probe.getTime())) return null;
    const [datePart, timePart] = full.split(' ');
    const [y, m, d] = datePart.split('-').map(Number);
    // new Date() silently rolls over impossible dates (Feb 30 → Mar 2);
    // require the parsed parts to round-trip exactly.
    if (probe.getFullYear() !== y || probe.getMonth() + 1 !== m || probe.getDate() !== d) return null;
    const [hh, mm] = timePart.split(':').map(Number);
    if (hh > 23 || mm > 59) return null;
    return full;
}
