"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ArrowUp, ArrowDown, CaseSensitive, WholeWord, Regex } from 'lucide-react';
import type { Editor as TipTapEditor } from '@tiptap/react';
import { searchHighlightKey } from './extensions/SearchHighlight';
import { stepIndex, type FindOptions } from '@/lib/inEntryFind';

/**
 * In-entry find bar (J8 Ctrl+F / F3 parity). Highlights every match in the
 * open entry and cycles through them; the global cross-entry SearchPanel keeps
 * Ctrl+F, so this bar opens on its own command and lives inside the editor.
 */
export default function FindBar({ editor, onClose }: { editor: TipTapEditor | null; onClose: () => void }) {
    const [query, setQuery] = useState('');
    const [opts, setOpts] = useState<FindOptions>({});
    const [count, setCount] = useState(0);
    const [active, setActive] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const readState = useCallback(() => {
        if (!editor) return { count: 0, active: 0 };
        const s = searchHighlightKey.getState(editor.state);
        return { count: s?.matches.length ?? 0, active: s?.active ?? 0 };
    }, [editor]);

    const scrollActiveIntoView = useCallback(() => {
        if (!editor) return;
        // Defer so the decoration DOM has been painted before we scroll.
        requestAnimationFrame(() => {
            const el = editor.view.dom.querySelector('.search-match-active');
            el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
    }, [editor]);

    // Recompute matches for a query/options change. Driven from input handlers
    // (not an effect) so we never call setState synchronously inside an effect.
    const runSearch = useCallback((q: string, o: FindOptions) => {
        if (!editor) return;
        editor.commands.setSearchTerm(q, o);
        const s = readState();
        setCount(s.count);
        setActive(s.active);
        if (s.count > 0) scrollActiveIntoView();
    }, [editor, readState, scrollActiveIntoView]);

    // Clear the highlight when the bar unmounts.
    useEffect(() => {
        return () => { editor?.commands.clearSearch(); };
    }, [editor]);

    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

    const onQueryChange = (q: string) => { setQuery(q); runSearch(q, opts); };
    const onToggleOption = (k: keyof FindOptions) => {
        const next = { ...opts, [k]: !opts[k] };
        setOpts(next);
        runSearch(query, next);
    };

    const go = useCallback((dir: 1 | -1) => {
        if (!editor || count === 0) return;
        const next = stepIndex(count, active, dir);
        editor.commands.setSearchActive(next);
        setActive(next);
        scrollActiveIntoView();
    }, [editor, count, active, scrollActiveIntoView]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        else if (e.key === 'F3') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    };

    const optBtn = (k: keyof FindOptions, Icon: typeof CaseSensitive, title: string) => (
        <button
            type="button"
            title={title}
            onClick={() => onToggleOption(k)}
            className={`p-1 rounded ${opts[k] ? 'bg-accent-primary text-white' : 'text-text-muted hover:bg-bg-app'}`}
        >
            <Icon size={15} />
        </button>
    );

    return (
        <div className="absolute top-2 right-3 z-30 flex items-center gap-1 rounded-md border border-border-primary bg-bg-secondary px-2 py-1 shadow-lg">
            <input
                ref={inputRef}
                value={query}
                onChange={e => onQueryChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Find in entry"
                className="w-44 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
            <span className="min-w-[3.5rem] text-center text-xs text-text-muted tabular-nums">
                {count > 0 ? `${active + 1} of ${count}` : query ? 'No results' : ''}
            </span>
            {optBtn('caseSensitive', CaseSensitive, 'Match case')}
            {optBtn('wholeWord', WholeWord, 'Whole word')}
            {optBtn('regex', Regex, 'Regular expression')}
            <button type="button" title="Previous (Shift+F3)" onClick={() => go(-1)} disabled={count === 0}
                className="p-1 rounded text-text-muted hover:bg-bg-app disabled:opacity-40">
                <ArrowUp size={15} />
            </button>
            <button type="button" title="Next (F3)" onClick={() => go(1)} disabled={count === 0}
                className="p-1 rounded text-text-muted hover:bg-bg-app disabled:opacity-40">
                <ArrowDown size={15} />
            </button>
            <button type="button" title="Close (Esc)" onClick={onClose}
                className="p-1 rounded text-text-muted hover:bg-bg-app">
                <X size={15} />
            </button>
        </div>
    );
}
