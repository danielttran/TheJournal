/**
 * Feature: Entry sorting
 *  - sortEntries(rows, sortMode) returns a stable, sorted copy of the input array.
 *  - Modes: 'manual' (SortOrder asc), 'title-asc', 'title-desc',
 *    'created-newest', 'created-oldest', 'modified-newest', 'modified-oldest'.
 *  - Pinned entries always float to the top (PinnedDate desc).
 */
import { describe, it, expect } from 'vitest';
import { sortEntries, type SortMode } from '../../src/lib/sort';

const mkEntry = (over: Partial<any> = {}) => ({
    EntryID: Math.random(),
    Title: 'Untitled',
    SortOrder: 0,
    CreatedDate: '2024-01-01 12:00:00',
    ModifiedDate: '2024-01-01 12:00:00',
    IsPinned: false,
    PinnedDate: null,
    ...over,
});

const ids = (xs: any[]) => xs.map(x => x.EntryID);

describe('sortEntries', () => {
    it('manual: orders by SortOrder asc', () => {
        const a = mkEntry({ EntryID: 1, SortOrder: 3 });
        const b = mkEntry({ EntryID: 2, SortOrder: 1 });
        const c = mkEntry({ EntryID: 3, SortOrder: 2 });
        expect(ids(sortEntries([a, b, c], 'manual'))).toEqual([2, 3, 1]);
    });

    it('title-asc: alphabetic, case-insensitive', () => {
        const a = mkEntry({ EntryID: 1, Title: 'Banana' });
        const b = mkEntry({ EntryID: 2, Title: 'apple' });
        const c = mkEntry({ EntryID: 3, Title: 'cherry' });
        expect(ids(sortEntries([a, b, c], 'title-asc'))).toEqual([2, 1, 3]);
    });

    it('title-desc: reverse alphabetic', () => {
        const a = mkEntry({ EntryID: 1, Title: 'Banana' });
        const b = mkEntry({ EntryID: 2, Title: 'apple' });
        expect(ids(sortEntries([a, b], 'title-desc'))).toEqual([1, 2]);
    });

    it('created-newest: latest CreatedDate first', () => {
        const old = mkEntry({ EntryID: 1, CreatedDate: '2024-01-01 12:00:00' });
        const mid = mkEntry({ EntryID: 2, CreatedDate: '2024-03-01 12:00:00' });
        const recent = mkEntry({ EntryID: 3, CreatedDate: '2024-12-01 12:00:00' });
        expect(ids(sortEntries([old, mid, recent], 'created-newest'))).toEqual([3, 2, 1]);
    });

    it('created-oldest: oldest first', () => {
        const old = mkEntry({ EntryID: 1, CreatedDate: '2024-01-01 12:00:00' });
        const recent = mkEntry({ EntryID: 2, CreatedDate: '2024-12-01 12:00:00' });
        expect(ids(sortEntries([recent, old], 'created-oldest'))).toEqual([1, 2]);
    });

    it('modified-newest: latest ModifiedDate first', () => {
        const stale = mkEntry({ EntryID: 1, ModifiedDate: '2024-01-01 12:00:00' });
        const fresh = mkEntry({ EntryID: 2, ModifiedDate: '2024-12-01 12:00:00' });
        expect(ids(sortEntries([stale, fresh], 'modified-newest'))).toEqual([2, 1]);
    });

    it('modified-oldest: oldest ModifiedDate first', () => {
        const stale = mkEntry({ EntryID: 1, ModifiedDate: '2024-01-01 12:00:00' });
        const fresh = mkEntry({ EntryID: 2, ModifiedDate: '2024-12-01 12:00:00' });
        expect(ids(sortEntries([fresh, stale], 'modified-oldest'))).toEqual([1, 2]);
    });

    it('pinned entries float to top regardless of sort mode', () => {
        const pinned = mkEntry({ EntryID: 1, Title: 'Zebra', IsPinned: true, PinnedDate: '2024-06-01T00:00:00Z' });
        const a = mkEntry({ EntryID: 2, Title: 'Apple' });
        const b = mkEntry({ EntryID: 3, Title: 'Banana' });
        const sorted = sortEntries([a, b, pinned], 'title-asc');
        expect(ids(sorted)[0]).toBe(1); // Zebra is pinned, comes first
    });

    it('multiple pinned entries: sorted by PinnedDate desc', () => {
        const p1 = mkEntry({ EntryID: 1, Title: 'A', IsPinned: true, PinnedDate: '2024-01-01T00:00:00Z' });
        const p2 = mkEntry({ EntryID: 2, Title: 'B', IsPinned: true, PinnedDate: '2024-06-01T00:00:00Z' });
        const out = sortEntries([p1, p2], 'title-asc');
        expect(ids(out)).toEqual([2, 1]);
    });

    it('does not mutate the input array', () => {
        const a = mkEntry({ EntryID: 1, Title: 'b' });
        const b = mkEntry({ EntryID: 2, Title: 'a' });
        const input = [a, b];
        sortEntries(input, 'title-asc');
        expect(input[0]).toBe(a);
        expect(input[1]).toBe(b);
    });
});
