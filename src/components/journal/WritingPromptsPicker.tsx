"use client";

import { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Search, Shuffle } from 'lucide-react';
import { WRITING_PROMPTS, PROMPT_CATEGORIES, type WritingPrompt, type PromptCategory } from '@/lib/prompts';

interface WritingPromptsPickerProps {
    onSelect: (prompt: WritingPrompt) => void;
    onClose: () => void;
}

export default function WritingPromptsPicker({ onSelect, onClose }: WritingPromptsPickerProps) {
    const [activeCategory, setActiveCategory] = useState<PromptCategory | 'All'>('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [highlighted, setHighlighted] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        searchRef.current?.focus();
    }, []);

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    const filtered = WRITING_PROMPTS.filter(p => {
        const matchesCategory = activeCategory === 'All' || p.category === activeCategory;
        const matchesSearch = !searchQuery.trim() || p.text.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    const pickRandom = () => {
        const pool = filtered.length > 0 ? filtered : WRITING_PROMPTS;
        const random = pool[Math.floor(Math.random() * pool.length)];
        setHighlighted(random.id);
        setTimeout(() => {
            onSelect(random);
        }, 200);
    };

    const CATEGORY_COLORS: Record<string, string> = {
        Gratitude: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        Reflection: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        Emotions: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
        Goals: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
        Fun: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
    };

    return (
        <div
            className="fixed inset-0 z-[500] bg-black/60 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-bg-card border border-border-primary rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border-primary flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-accent-primary" />
                        <h2 className="font-semibold text-text-primary">Writing Prompts</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={pickRandom}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 text-sm font-medium transition-colors"
                            title="Pick a random prompt"
                        >
                            <Shuffle className="w-3.5 h-3.5" />
                            Random
                        </button>
                        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="px-4 py-3 border-b border-border-primary flex-shrink-0">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-2.5 text-text-muted pointer-events-none" />
                        <input
                            ref={searchRef}
                            type="text"
                            placeholder="Search prompts..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full bg-bg-active text-text-primary pl-9 pr-3 py-2 rounded-lg border border-border-primary focus:outline-none focus:border-accent-primary text-sm"
                        />
                    </div>
                </div>

                {/* Category filter */}
                <div className="px-4 py-2 flex gap-2 overflow-x-auto flex-shrink-0 border-b border-border-primary">
                    <button
                        onClick={() => setActiveCategory('All')}
                        className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                            activeCategory === 'All'
                                ? 'bg-accent-primary/20 text-accent-primary border-accent-primary/40'
                                : 'bg-transparent text-text-muted border-border-primary hover:bg-bg-hover'
                        }`}
                    >
                        All ({WRITING_PROMPTS.length})
                    </button>
                    {PROMPT_CATEGORIES.map(cat => {
                        const count = WRITING_PROMPTS.filter(p => p.category === cat).length;
                        const isActive = activeCategory === cat;
                        return (
                            <button
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                                    isActive
                                        ? CATEGORY_COLORS[cat]
                                        : 'bg-transparent text-text-muted border-border-primary hover:bg-bg-hover'
                                }`}
                            >
                                {cat} ({count})
                            </button>
                        );
                    })}
                </div>

                {/* Prompts list */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
                    {filtered.length === 0 ? (
                        <p className="text-center text-text-muted text-sm py-8">No prompts match your search.</p>
                    ) : (
                        filtered.map(prompt => (
                            <button
                                key={prompt.id}
                                onClick={() => onSelect(prompt)}
                                className={`w-full text-left px-4 py-3 rounded-lg border transition-all text-sm text-text-primary hover:border-accent-primary/50 hover:bg-accent-primary/5 ${
                                    highlighted === prompt.id
                                        ? 'border-accent-primary bg-accent-primary/10'
                                        : 'border-border-primary bg-bg-app'
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <span className={`mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${CATEGORY_COLORS[prompt.category]}`}>
                                        {prompt.category}
                                    </span>
                                    <span>{prompt.text}</span>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
