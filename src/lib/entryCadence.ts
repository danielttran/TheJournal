/**
 * Missed-cadence highlighting for the category calendar. Category Properties'
 * "Entry frequency" promises "used by the calendar to highlight missed days" —
 * this is that consumer. Pure grid math so it's testable without a DOM.
 */

export type EntryFrequency = 'daily' | 'weekly' | 'hourly';

export interface MissedDaysInput {
    /** 'yyyy-MM-dd' per grid cell, in render order (whole weeks, rows of 7). */
    days: string[];
    /** Whether each cell belongs to the displayed month (others never mark). */
    inCurrentMonth: boolean[];
    /** Whether each cell's day has at least one entry. */
    hasEntry: boolean[];
    /** Today as 'yyyy-MM-dd'; only days strictly before it can be "missed". */
    todayYmd: string;
    frequency: EntryFrequency;
}

/**
 * Returns a parallel boolean[]: true = render the cell with the missed marker.
 * - daily (and hourly — finer than a month grid can show): any past
 *   in-month day with no entry.
 * - weekly: a fully-elapsed week with zero entries marks only its last
 *   in-month day, so one missed week doesn't paint seven cells.
 */
export function computeMissedDays(input: MissedDaysInput): boolean[] {
    const { days, inCurrentMonth, hasEntry, todayYmd, frequency } = input;
    const missed = new Array<boolean>(days.length).fill(false);
    if (days.length === 0 || days.length !== inCurrentMonth.length || days.length !== hasEntry.length) {
        return missed;
    }

    if (frequency === 'weekly') {
        for (let start = 0; start + 7 <= days.length; start += 7) {
            let weekElapsed = true;
            let weekHasEntry = false;
            let lastInMonth = -1;
            for (let i = start; i < start + 7; i++) {
                if (days[i] >= todayYmd) weekElapsed = false;
                if (hasEntry[i]) weekHasEntry = true;
                if (inCurrentMonth[i]) lastInMonth = i;
            }
            if (weekElapsed && !weekHasEntry && lastInMonth !== -1) {
                missed[lastInMonth] = true;
            }
        }
        return missed;
    }

    for (let i = 0; i < days.length; i++) {
        missed[i] = inCurrentMonth[i] && days[i] < todayYmd && !hasEntry[i];
    }
    return missed;
}
