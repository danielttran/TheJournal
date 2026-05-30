import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { findMatchesInText, type FindOptions } from '@/lib/inEntryFind';

/**
 * In-entry find highlighting (J8 Ctrl+F / F3 parity).
 *
 * A ProseMirror plugin that decorates every match of the active query and marks
 * the "current" one distinctly so the find bar can cycle through them with
 * F3 / Shift+F3. The match maths live in `src/lib/inEntryFind.ts` (unit-tested);
 * this only walks text nodes and maps offsets to document positions.
 *
 * Cross-node matches (text split by an inline mark boundary) are not joined —
 * matching is per text node, which covers ordinary prose find. The find bar
 * reads `searchHighlightKey.getState(editor.state)` for the count + active idx.
 */

export interface SearchHighlightState {
    query: string;
    options: FindOptions;
    active: number;
    matches: { from: number; to: number }[];
    decorations: DecorationSet;
}

export const searchHighlightKey = new PluginKey<SearchHighlightState>('searchHighlight');

interface SearchMeta {
    query?: string;
    options?: FindOptions;
    active?: number;
}

function computeMatches(doc: PMNode, query: string, options: FindOptions): { from: number; to: number }[] {
    const out: { from: number; to: number }[] = [];
    if (!query) return out;
    doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        for (const m of findMatchesInText(node.text, query, options)) {
            out.push({ from: pos + m.start, to: pos + m.end });
        }
    });
    return out;
}

function buildDecorations(
    doc: PMNode,
    matches: { from: number; to: number }[],
    active: number,
): DecorationSet {
    if (matches.length === 0) return DecorationSet.empty;
    const decos = matches.map((m, i) =>
        Decoration.inline(m.from, m.to, {
            class: i === active ? 'search-match search-match-active' : 'search-match',
        }),
    );
    return DecorationSet.create(doc, decos);
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        searchHighlight: {
            /** Set the active query + options and recompute matches. */
            setSearchTerm: (query: string, options?: FindOptions) => ReturnType;
            /** Set which match is "current" (0-based). */
            setSearchActive: (active: number) => ReturnType;
            /** Clear the highlight entirely. */
            clearSearch: () => ReturnType;
        };
    }
}

export const SearchHighlight = Extension.create({
    name: 'searchHighlight',

    addCommands() {
        return {
            setSearchTerm:
                (query, options = {}) =>
                ({ tr, dispatch }) => {
                    if (dispatch) dispatch(tr.setMeta(searchHighlightKey, { query, options } as SearchMeta));
                    return true;
                },
            setSearchActive:
                (active) =>
                ({ tr, dispatch }) => {
                    if (dispatch) dispatch(tr.setMeta(searchHighlightKey, { active } as SearchMeta));
                    return true;
                },
            clearSearch:
                () =>
                ({ tr, dispatch }) => {
                    if (dispatch) dispatch(tr.setMeta(searchHighlightKey, { query: '', options: {} } as SearchMeta));
                    return true;
                },
        };
    },

    addProseMirrorPlugins() {
        return [
            new Plugin<SearchHighlightState>({
                key: searchHighlightKey,
                state: {
                    init(): SearchHighlightState {
                        return {
                            query: '',
                            options: {},
                            active: 0,
                            matches: [],
                            decorations: DecorationSet.empty,
                        };
                    },
                    apply(tr: Transaction, value: SearchHighlightState, _old: EditorState, newState: EditorState): SearchHighlightState {
                        const meta = tr.getMeta(searchHighlightKey) as SearchMeta | undefined;
                        let { query, options, active } = value;
                        let recompute = false;

                        if (meta) {
                            if (meta.query !== undefined) {
                                query = meta.query;
                                options = meta.options ?? {};
                                active = 0;
                                recompute = true;
                            }
                            if (meta.active !== undefined) {
                                active = meta.active;
                                recompute = true;
                            }
                        }
                        if (tr.docChanged) recompute = true;

                        if (!recompute) return value;

                        const matches = computeMatches(newState.doc, query, options);
                        // Keep the active match near where the user was rather than
                        // wrapping: if edits shrank the match list, stay on the last.
                        if (active >= matches.length) active = matches.length > 0 ? matches.length - 1 : 0;
                        if (active < 0) active = 0;
                        return {
                            query,
                            options,
                            active,
                            matches,
                            decorations: buildDecorations(newState.doc, matches, active),
                        };
                    },
                },
                props: {
                    decorations(state) {
                        return searchHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
                    },
                },
            }),
        ];
    },
});
