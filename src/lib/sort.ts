export type SortMode =
    | 'manual'
    | 'title-asc'
    | 'title-desc'
    | 'created-newest'
    | 'created-oldest'
    | 'modified-newest'
    | 'modified-oldest';

export interface SortableEntry {
    EntryID: number;
    Title?: string;
    SortOrder?: number;
    CreatedDate?: string;
    ModifiedDate?: string;
    IsPinned?: boolean;
    PinnedDate?: string | null;
}

const compareString = (a: string | undefined, b: string | undefined, dir: 1 | -1) =>
    dir * (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base', numeric: true });

const compareDate = (a: string | undefined, b: string | undefined, dir: 1 | -1) =>
    dir * ((a ?? '').localeCompare(b ?? ''));

export function sortEntries<T extends SortableEntry>(rows: T[], mode: SortMode): T[] {
    const copy = rows.slice();
    copy.sort((a, b) => {
        // Pinned floats to top
        const aP = a.IsPinned ? 1 : 0;
        const bP = b.IsPinned ? 1 : 0;
        if (aP !== bP) return bP - aP;
        if (aP === 1 && bP === 1) {
            // Both pinned → newer pin first
            return compareDate(b.PinnedDate ?? undefined, a.PinnedDate ?? undefined, 1);
        }

        switch (mode) {
            case 'manual':
                return (a.SortOrder ?? 0) - (b.SortOrder ?? 0);
            case 'title-asc':  return compareString(a.Title, b.Title, 1);
            case 'title-desc': return compareString(a.Title, b.Title, -1);
            case 'created-newest':  return compareDate(b.CreatedDate, a.CreatedDate, 1);
            case 'created-oldest':  return compareDate(a.CreatedDate, b.CreatedDate, 1);
            case 'modified-newest': return compareDate(b.ModifiedDate, a.ModifiedDate, 1);
            case 'modified-oldest': return compareDate(a.ModifiedDate, b.ModifiedDate, 1);
        }
    });
    return copy;
}
