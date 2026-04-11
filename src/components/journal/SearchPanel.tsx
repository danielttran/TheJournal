"use client";

import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { Search, X, ChevronDown, ChevronUp, SlidersHorizontal, Calendar, Tag, FileText, AlignLeft, BookOpen } from 'lucide-react';
import { format } from 'date-fns';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchResult {
    EntryID: number;
    Title: string;
    CategoryID: number;
    CategoryName: string;
    CategoryType: string;
    CreatedDate: string;
    ModifiedDate: string;
    EntryType: string;
    snippet: string;
    titleMatch: boolean;
    contentMatch: boolean;
}

interface SearchPanelProps {
    /** The currently active categoryId (used to scope simple searches). */
    currentCategoryId: string;
    currentCategoryType: string;
    onClose: () => void;
    /** Called when user clicks a result — navigate to that entry. */
    onNavigate: (categoryId: number, entryId: number, categoryType: string) => void;
}

// ─── Highlight helper ────────────────────────────────────────────────────────
// Wraps every occurrence of `term` in the `text` with <mark> styling.
function HighlightedText({ text, term }: { text: string; term: string }) {
    if (!term.trim()) return <>{text}</>;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(re);
    return (
        <>
            {parts.map((part, i) =>
                re.test(part)
                    ? <mark key={i} className="bg-yellow-300/30 text-yellow-200 rounded-sm px-0.5">{part}</mark>
                    : part
            )}
        </>
    );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SearchPanel({
    currentCategoryId,
    currentCategoryType,
    onClose,
    onNavigate,
}: SearchPanelProps) {
    const inputId = useId();

    // ── Query state ──────────────────────────────────────────────────────────
    const [query, setQuery] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Advanced filters
    const [searchIn, setSearchIn] = useState<'both' | 'title' | 'content'>('both');
    const [scopeCategory, setScopeCategory] = useState<'all' | 'current'>('current');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [entryType, setEntryType] = useState<'' | 'Page' | 'Folder'>('');
    const [matchCase, setMatchCase] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);

    // ── Results state ─────────────────────────────────────────────────────────
    const [results, setResults] = useState<SearchResult[]>([]);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [searched, setSearched] = useState(false); // true once first search fired

    // ── Refs ──────────────────────────────────────────────────────────────────
    const inputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const offsetRef = useRef(0);

    useEffect(() => { inputRef.current?.focus(); }, []);

    // Abort any in-flight search when the panel unmounts (e.g. user closes it
    // while a slow query is still running) to avoid state updates on dead component.
    useEffect(() => {
        return () => { abortRef.current?.abort(); };
    }, []);

    // ── Search execution ──────────────────────────────────────────────────────
    const executeSearch = useCallback(async (q: string, append = false) => {
        if (!q.trim()) { setResults([]); setTotal(0); setSearched(false); return; }

        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        if (!append) { offsetRef.current = 0; setLoading(true); setError(false); }

        const params = new URLSearchParams({ q, limit: '30', offset: String(offsetRef.current) });
        if (scopeCategory === 'current') params.set('categoryId', currentCategoryId);
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        if (searchIn !== 'both') params.set('searchIn', searchIn);
        if (entryType) params.set('entryType', entryType);
        if (matchCase) params.set('matchCase', '1');
        if (wholeWord) params.set('wholeWord', '1');

        try {
            const res = await fetch(`/api/search?${params}`, { signal: ctrl.signal });
            if (!res.ok) throw new Error();
            const data = await res.json();
            setResults(prev => append ? [...prev, ...(data.results || [])] : (data.results || []));
            setTotal(data.total ?? 0);
            setHasMore(data.hasMore ?? false);
            setSearched(true);
        } catch (e: any) {
            if (e?.name === 'AbortError') return;
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [currentCategoryId, scopeCategory, dateFrom, dateTo, searchIn, entryType, matchCase, wholeWord]);

    // Debounce simple search as user types
    const debounceRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => executeSearch(query), 350);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    // Re-run when any filter changes (only if we've searched at least once)
    useEffect(() => {
        if (searched) executeSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchIn, scopeCategory, dateFrom, dateTo, entryType, matchCase, wholeWord]);

    const loadMore = () => {
        offsetRef.current += 30;
        executeSearch(query, true);
    };

    // ── Navigation ────────────────────────────────────────────────────────────
    const handleResultClick = (r: SearchResult) => {
        onNavigate(r.CategoryID, r.EntryID, r.CategoryType);
        onClose();
    };

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter') executeSearch(query);
    };

    // ── Rendering ─────────────────────────────────────────────────────────────
    const hasFilters = dateFrom || dateTo || entryType || matchCase || wholeWord || searchIn !== 'both' || scopeCategory !== 'current';

    return (
        /* Backdrop */
        <div
            className="fixed inset-0 z-[400] bg-black/50 flex items-start justify-center pt-[10vh]"
            onClick={onClose}
        >
            {/* Panel */}
            <div
                className="w-full max-w-2xl mx-4 bg-bg-card border border-border-primary rounded-xl shadow-2xl flex flex-col max-h-[80vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* ── Search bar ── */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border-primary">
                    <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
                    <input
                        ref={inputRef}
                        id={inputId}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search entries…"
                        className="flex-1 bg-transparent text-sm text-text-primary focus:outline-none placeholder:text-text-muted"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {loading && (
                        <div className="w-3.5 h-3.5 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin flex-shrink-0" />
                    )}
                    {/* Advanced toggle */}
                    <button
                        onClick={() => setShowAdvanced(v => !v)}
                        title="Advanced search"
                        className={`p-1.5 rounded transition-colors flex-shrink-0 ${showAdvanced || hasFilters ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}
                    >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover flex-shrink-0 transition-colors"
                        title="Close (Esc)"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* ── Advanced filters ── */}
                {showAdvanced && (
                    <div className="px-4 py-3 border-b border-border-primary bg-bg-sidebar space-y-3 text-sm">
                        {/* Row 1: Search in + Scope */}
                        <div className="flex flex-wrap gap-4">
                            <div className="flex items-center gap-2">
                                <AlignLeft className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                                <span className="text-text-muted text-xs">Search in</span>
                                <div className="flex rounded-md border border-border-primary overflow-hidden text-xs">
                                    {(['both', 'title', 'content'] as const).map(v => (
                                        <button
                                            key={v}
                                            onClick={() => setSearchIn(v)}
                                            className={`px-2.5 py-1 capitalize transition-colors ${searchIn === v ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
                                        >
                                            {v === 'both' ? 'Both' : v === 'title' ? 'Title' : 'Content'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <BookOpen className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                                <span className="text-text-muted text-xs">Scope</span>
                                <div className="flex rounded-md border border-border-primary overflow-hidden text-xs">
                                    <button
                                        onClick={() => setScopeCategory('current')}
                                        className={`px-2.5 py-1 transition-colors ${scopeCategory === 'current' ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
                                    >
                                        This journal
                                    </button>
                                    <button
                                        onClick={() => setScopeCategory('all')}
                                        className={`px-2.5 py-1 transition-colors ${scopeCategory === 'all' ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
                                    >
                                        All journals
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Row 2: Date range */}
                        <div className="flex flex-wrap gap-4 items-center">
                            <div className="flex items-center gap-2">
                                <Calendar className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                                <span className="text-text-muted text-xs">From</span>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={e => setDateFrom(e.target.value)}
                                    className="text-xs bg-bg-active border border-border-primary rounded px-2 py-1 text-text-primary focus:outline-none focus:border-accent-primary"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-text-muted text-xs">To</span>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={e => setDateTo(e.target.value)}
                                    className="text-xs bg-bg-active border border-border-primary rounded px-2 py-1 text-text-primary focus:outline-none focus:border-accent-primary"
                                />
                            </div>
                            {(dateFrom || dateTo) && (
                                <button
                                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                                    className="text-xs text-text-muted hover:text-red-400 transition-colors"
                                >
                                    Clear dates
                                </button>
                            )}
                        </div>

                        {/* Row 3: Entry type + Match options */}
                        <div className="flex flex-wrap gap-4 items-center">
                            <div className="flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                                <span className="text-text-muted text-xs">Type</span>
                                <select
                                    value={entryType}
                                    onChange={e => setEntryType(e.target.value as any)}
                                    className="text-xs bg-bg-active border border-border-primary rounded px-2 py-1 text-text-primary focus:outline-none focus:border-accent-primary"
                                >
                                    <option value="">All</option>
                                    <option value="Page">Page</option>
                                    <option value="Folder">Folder</option>
                                </select>
                            </div>
                            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={matchCase}
                                    onChange={e => setMatchCase(e.target.checked)}
                                    className="rounded border-border-primary accent-accent-primary"
                                />
                                Match case
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={wholeWord}
                                    onChange={e => setWholeWord(e.target.checked)}
                                    className="rounded border-border-primary accent-accent-primary"
                                />
                                Whole word
                            </label>
                        </div>
                    </div>
                )}

                {/* ── Results ── */}
                <div className="flex-1 overflow-y-auto">
                    {/* Status bar */}
                    {searched && !loading && (
                        <div className="px-4 py-2 text-xs text-text-muted border-b border-border-primary bg-bg-sidebar flex items-center justify-between">
                            <span>
                                {total === 0
                                    ? 'No results'
                                    : `${total} result${total !== 1 ? 's' : ''}${scopeCategory === 'all' ? ' across all journals' : ''}`
                                }
                            </span>
                            {query && (
                                <button
                                    onClick={() => { setQuery(''); setResults([]); setSearched(false); inputRef.current?.focus(); }}
                                    className="text-text-muted hover:text-red-400 transition-colors flex items-center gap-1"
                                >
                                    <X className="w-3 h-3" /> Clear
                                </button>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="px-4 py-6 text-center text-sm text-red-400">
                            Search failed. Please try again.
                        </div>
                    )}

                    {!searched && !loading && !error && (
                        <div className="px-4 py-10 text-center text-sm text-text-muted">
                            <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
                            Type to search your entries
                        </div>
                    )}

                    {results.length > 0 && (
                        <ul className="divide-y divide-border-primary">
                            {results.map(r => (
                                <li key={r.EntryID}>
                                    <button
                                        onClick={() => handleResultClick(r)}
                                        className="w-full text-left px-4 py-3 hover:bg-bg-hover transition-colors group"
                                    >
                                        {/* Title + meta row */}
                                        <div className="flex items-start justify-between gap-3 mb-1">
                                            <span className="text-sm font-medium text-text-primary group-hover:text-accent-primary transition-colors truncate flex-1">
                                                <HighlightedText text={r.Title} term={query} />
                                            </span>
                                            <div className="flex items-center gap-2 flex-shrink-0 text-[10px] text-text-muted">
                                                {scopeCategory === 'all' && (
                                                    <span className="flex items-center gap-1">
                                                        <Tag className="w-2.5 h-2.5" />
                                                        {r.CategoryName}
                                                    </span>
                                                )}
                                                <span>
                                                    {r.CreatedDate
                                                        ? format(new Date(r.CreatedDate), r.CategoryType === 'Journal' ? 'MMM d, yyyy' : 'MMM d, yyyy')
                                                        : ''}
                                                </span>
                                            </div>
                                        </div>
                                        {/* Snippet */}
                                        {r.snippet && (
                                            <p className="text-xs text-text-muted leading-relaxed line-clamp-2">
                                                <HighlightedText text={r.snippet} term={query} />
                                            </p>
                                        )}
                                        {/* Match badges */}
                                        <div className="flex items-center gap-1.5 mt-1.5">
                                            {r.titleMatch && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-active text-text-muted">title</span>
                                            )}
                                            {r.contentMatch && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-active text-text-muted">content</span>
                                            )}
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {hasMore && (
                        <div className="px-4 py-3 text-center">
                            <button
                                onClick={loadMore}
                                disabled={loading}
                                className="text-sm text-accent-primary hover:underline disabled:opacity-50"
                            >
                                {loading ? 'Loading…' : `Load more (${total - results.length} remaining)`}
                            </button>
                        </div>
                    )}

                    {searched && !loading && results.length === 0 && !error && (
                        <div className="px-4 py-10 text-center text-sm text-text-muted">
                            No entries match <span className="text-text-primary">"{query}"</span>
                        </div>
                    )}
                </div>

                {/* ── Footer keyboard hint ── */}
                <div className="px-4 py-2 border-t border-border-primary bg-bg-sidebar flex items-center gap-4 text-[10px] text-text-muted">
                    <span><kbd className="bg-bg-active border border-border-primary rounded px-1 py-0.5">Enter</kbd> search</span>
                    <span><kbd className="bg-bg-active border border-border-primary rounded px-1 py-0.5">Esc</kbd> close</span>
                    <span><kbd className="bg-bg-active border border-border-primary rounded px-1 py-0.5">Ctrl+F</kbd> open</span>
                    <div className="flex-1" />
                    <button
                        onClick={() => setShowAdvanced(v => !v)}
                        className="flex items-center gap-1 hover:text-text-primary transition-colors"
                    >
                        <SlidersHorizontal className="w-3 h-3" />
                        {showAdvanced ? 'Hide' : 'Show'} advanced
                        {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                </div>
            </div>
        </div>
    );
}
