"use client";

import { useEffect, useState } from 'react';
import { Cloud, X } from 'lucide-react';

interface Props {
    categoryId?: number;
    onClose: () => void;
}

interface WordEntry { word: string; count: number; }

export default function WordCloudPanel({ categoryId, onClose }: Props) {
    const [words, setWords] = useState<WordEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const ctl = new AbortController();
        const qs = categoryId !== undefined ? `?categoryId=${categoryId}` : '';
        setLoading(true);
        fetch(`/api/wordcloud${qs}`, { signal: ctl.signal })
            .then(r => r.ok ? r.json() : { words: [] })
            .then(d => { if (!ctl.signal.aborted) setWords(d.words ?? []); })
            .catch(err => { if (err?.name !== 'AbortError') throw err; })
            .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
        return () => ctl.abort();
    }, [categoryId]);

    const max = Math.max(1, ...words.map(w => w.count));
    const min = Math.min(...words.map(w => w.count), 1);
    const sizeFor = (count: number) => {
        // 12 → 36 px font, log scale
        const norm = max === min ? 0.5 : (Math.log(count) - Math.log(min)) / (Math.log(max) - Math.log(min));
        return Math.round(12 + norm * 24);
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
            <div className="bg-bg-card border border-border-primary rounded-lg shadow-2xl w-[760px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div className="flex items-center gap-2">
                        <Cloud className="w-4 h-4 text-text-muted" />
                        <h2 className="font-semibold text-text-primary">Word cloud{categoryId !== undefined ? ' · this category' : ' · all entries'}</h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                    {loading && <div className="text-center text-text-muted py-6">Crunching words…</div>}
                    {!loading && words.length === 0 && (
                        <div className="text-center text-text-muted py-12">
                            <Cloud className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <div>Not enough text yet.</div>
                        </div>
                    )}
                    {!loading && words.length > 0 && (
                        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 leading-tight">
                            {words.map(w => (
                                <span
                                    key={w.word}
                                    title={`${w.count} occurrence${w.count === 1 ? '' : 's'}`}
                                    style={{ fontSize: `${sizeFor(w.count)}px` }}
                                    className="text-accent-primary hover:text-text-primary cursor-default transition-colors"
                                >
                                    {w.word}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
