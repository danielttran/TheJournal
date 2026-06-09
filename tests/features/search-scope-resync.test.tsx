// @vitest-environment jsdom
/**
 * "Search Across All Categories…" must re-scope the SearchPanel even when it is
 * already open. initialScope only seeds useState, so without the
 * scopeRequestSeq resync effect the menu action was a silent no-op on a
 * mounted panel (regression from the 2026-06-08 menu audit fix #7).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import SearchPanel from '../../src/components/journal/SearchPanel';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function stubSearchFetch() {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        calls.push(String(url));
        return {
            ok: true,
            json: async () => (String(url).startsWith('/api/search')
                ? { results: [], total: 0, hasMore: false }
                : { items: [] }),
        };
    }));
    return calls;
}

describe('SearchPanel scope resync', () => {
    it('re-applies the requested scope when scopeRequestSeq bumps on a mounted panel', async () => {
        const calls = stubSearchFetch();
        const noop = () => {};
        const { rerender } = render(
            <SearchPanel
                currentCategoryId="5"
                currentCategoryType="Journal"
                initialScope="current"
                scopeRequestSeq={1}
                onClose={noop}
                onNavigate={noop}
            />,
        );

        // Fire a search scoped to the current category (Enter skips the debounce).
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'hello' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => {
            expect(calls.some(u => u.startsWith('/api/search') && u.includes('categoryId=5'))).toBe(true);
        });

        // "Search Across All Categories…" fires while the panel is open.
        rerender(
            <SearchPanel
                currentCategoryId="5"
                currentCategoryType="Journal"
                initialScope="all"
                scopeRequestSeq={2}
                onClose={noop}
                onNavigate={noop}
            />,
        );

        // The filter-change effect re-runs the search WITHOUT the category scope.
        await waitFor(() => {
            const searches = calls.filter(u => u.startsWith('/api/search'));
            expect(searches.length).toBeGreaterThan(1);
            expect(searches[searches.length - 1].includes('categoryId=')).toBe(false);
        });
    });

    it('re-applies "current" when Find… follows an all-categories search', async () => {
        const calls = stubSearchFetch();
        const noop = () => {};
        const { rerender } = render(
            <SearchPanel
                currentCategoryId="5"
                currentCategoryType="Journal"
                initialScope="all"
                scopeRequestSeq={1}
                onClose={noop}
                onNavigate={noop}
            />,
        );
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'hello' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => {
            expect(calls.some(u => u.startsWith('/api/search') && !u.includes('categoryId='))).toBe(true);
        });

        rerender(
            <SearchPanel
                currentCategoryId="5"
                currentCategoryType="Journal"
                initialScope="current"
                scopeRequestSeq={2}
                onClose={noop}
                onNavigate={noop}
            />,
        );
        await waitFor(() => {
            const searches = calls.filter(u => u.startsWith('/api/search'));
            expect(searches[searches.length - 1].includes('categoryId=5')).toBe(true);
        });
    });
});
