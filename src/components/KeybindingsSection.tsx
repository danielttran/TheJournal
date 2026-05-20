"use client";

import { useEffect, useState, useMemo } from 'react';
import { COMMANDS, parseBinding, resolveBindingForCommand, type CommandCategory } from '@/lib/commands';

type Overrides = Record<string, string | null>;

const CATEGORIES: CommandCategory[] = ['Edit', 'Format', 'Insert', 'View', 'Navigation', 'Security'];

export default function KeybindingsSection() {
    const [overrides, setOverrides] = useState<Overrides>({});
    const [captureFor, setCaptureFor] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                if (typeof window !== 'undefined' && window.electron?.getSettings) {
                    const s = await window.electron.getSettings();
                    if (!cancelled) setOverrides((s?.keybindings as Overrides | undefined) ?? {});
                } else {
                    const raw = localStorage.getItem('keybindings');
                    if (!cancelled) setOverrides(raw ? JSON.parse(raw) : {});
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, []);

    const persist = (next: Overrides) => {
        setOverrides(next);
        if (typeof window !== 'undefined' && window.electron?.saveSetting) {
            window.electron.saveSetting('keybindings', next);
        } else {
            localStorage.setItem('keybindings', JSON.stringify(next));
        }
        window.dispatchEvent(new Event('settings-changed'));
    };

    const startCapture = (commandId: string) => {
        setCaptureFor(commandId);
    };

    const clearBinding = (commandId: string) => {
        const next = { ...overrides, [commandId]: null };
        persist(next);
    };

    const resetBinding = (commandId: string) => {
        const next = { ...overrides };
        delete next[commandId];
        persist(next);
    };

    // Capture-mode keydown listener: arm by setting captureFor, then the next
    // keydown is interpreted as the binding instead of dispatched.
    useEffect(() => {
        if (!captureFor) return;
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') {
                setCaptureFor(null);
                return;
            }
            // Ignore lone modifier presses — wait for the terminal key.
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
            const parts: string[] = [];
            if (e.ctrlKey) parts.push('Ctrl');
            if (e.altKey)  parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');
            if (e.metaKey) parts.push('Meta');
            parts.push(e.key);
            const binding = parseBinding(parts.join('+'));
            if (binding) {
                persist({ ...overrides, [captureFor]: binding });
            }
            setCaptureFor(null);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [captureFor, overrides]);

    const grouped = useMemo(() => {
        const out: Record<CommandCategory, typeof COMMANDS> = {
            Edit: [], Format: [], Insert: [], View: [], Navigation: [], Security: [],
        };
        for (const c of COMMANDS) out[c.category].push(c);
        return out;
    }, []);

    return (
        <section>
            <h3 className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">Keyboard Shortcuts</h3>
            {loading && <p className="text-text-muted text-xs">Loading…</p>}
            {!loading && (
                <div className="space-y-4">
                    {CATEGORIES.map(cat => grouped[cat].length === 0 ? null : (
                        <div key={cat}>
                            <h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">{cat}</h4>
                            <div className="space-y-1">
                                {grouped[cat].map(cmd => {
                                    const active = resolveBindingForCommand(cmd.id, overrides);
                                    const isCustom = Object.prototype.hasOwnProperty.call(overrides, cmd.id);
                                    return (
                                        <div key={cmd.id} className="flex items-center justify-between gap-3 text-sm">
                                            <span className="text-text-primary truncate">{cmd.label}</span>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {captureFor === cmd.id ? (
                                                    <span className="px-2 py-0.5 rounded bg-accent-primary/10 text-accent-primary border border-accent-primary text-xs animate-pulse">
                                                        Press keys… (Esc to cancel)
                                                    </span>
                                                ) : (
                                                    <button
                                                        onClick={() => startCapture(cmd.id)}
                                                        className="px-2 py-0.5 rounded border border-border-primary bg-bg-active text-text-secondary hover:text-text-primary text-xs font-mono min-w-[80px]"
                                                    >
                                                        {active ?? '(unbound)'}
                                                    </button>
                                                )}
                                                {isCustom && (
                                                    <button
                                                        onClick={() => resetBinding(cmd.id)}
                                                        className="text-xs text-text-muted hover:text-text-primary"
                                                        title="Reset to default"
                                                    >
                                                        Reset
                                                    </button>
                                                )}
                                                {active && (
                                                    <button
                                                        onClick={() => clearBinding(cmd.id)}
                                                        className="text-xs text-text-muted hover:text-red-400"
                                                        title="Unbind this shortcut"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
