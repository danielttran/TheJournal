"use client";

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

export interface PromptOption { value: string; label: string; }

export interface PromptConfig {
    title: string;
    /** Optional helper text under the title. */
    message?: string;
    initialValue?: string;
    placeholder?: string;
    inputType?: 'text' | 'password';
    /** When set, render a <select> of these options instead of a text input. */
    options?: PromptOption[];
    confirmLabel?: string;
    /** Allow confirming with an empty value (e.g. "clear" flows). Default false. */
    allowEmpty?: boolean;
    /**
     * Return a non-empty string to show it as an inline error and keep the
     * dialog open (e.g. wrong password); return void/null to close.
     */
    onConfirm: (value: string) => void | string | null | Promise<void | string | null>;
}

/**
 * A small styled replacement for window.prompt — one reusable dialog for the
 * app's text / password / single-select prompts so they match the rest of the
 * UI (backdrop + Escape to dismiss, inline validation, keyboard submit).
 */
export default function PromptModal({ config, onClose }: { config: PromptConfig; onClose: () => void }) {
    useEscapeToClose(onClose);
    const [value, setValue] = useState(config.initialValue ?? (config.options?.[0]?.value ?? ''));
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

    const submit = async () => {
        if (busy) return;
        const v = config.options ? value : value.trim();
        if (!v && !config.allowEmpty && !config.options) { setError('Please enter a value.'); return; }
        setBusy(true);
        try {
            const result = await config.onConfirm(v);
            if (typeof result === 'string' && result) { setError(result); return; }
            onClose();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[700] flex items-center justify-center bg-black/40"
            onMouseDown={onClose}
        >
            <div
                className="w-[26rem] max-w-[90vw] rounded-lg border border-border-primary bg-bg-card p-4 shadow-2xl"
                onMouseDown={e => e.stopPropagation()}
            >
                <div className="mb-3 flex items-start justify-between gap-4">
                    <h3 className="text-sm font-semibold text-text-primary">{config.title}</h3>
                    <button onClick={onClose} className="p-0.5 rounded text-text-muted hover:text-text-primary" title="Close">
                        <X size={16} />
                    </button>
                </div>
                {config.message && <p className="mb-2 text-xs text-text-muted">{config.message}</p>}

                {config.options ? (
                    <select
                        value={value}
                        onChange={e => { setValue(e.target.value); setError(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
                        className="w-full rounded border border-border-primary bg-bg-app px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-primary"
                    >
                        {config.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                ) : (
                    <input
                        ref={inputRef}
                        type={config.inputType ?? 'text'}
                        value={value}
                        placeholder={config.placeholder}
                        onChange={e => { setValue(e.target.value); setError(''); }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); void submit(); }
                        }}
                        className="w-full rounded border border-border-primary bg-bg-app px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-primary"
                    />
                )}
                {error && <p className="mt-1 text-xs text-red-400">{error}</p>}

                <div className="mt-4 flex justify-end gap-2">
                    <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-app">Cancel</button>
                    <button onClick={() => void submit()} disabled={busy}
                        className="rounded bg-accent-primary px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50">
                        {config.confirmLabel ?? 'OK'}
                    </button>
                </div>
            </div>
        </div>
    );
}
