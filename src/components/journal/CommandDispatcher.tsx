"use client";

import { useEffect, useRef } from 'react';
import { COMMANDS, eventMatchesBinding, resolveBindingForCommand } from '@/lib/commands';

type CommandRunner = (commandId: string) => void;

/**
 * The runtime side of the command registry. Loads the user's keybinding
 * overrides from settings, listens at the window level, and dispatches
 * the first command whose binding matches the event.
 *
 * The actual command implementations live in `runCommand` below: it
 * dispatches a CustomEvent so existing trigger-* listeners in
 * Editor.tsx / TipTapToolbar.tsx pick the action up without a full
 * refactor.
 */
function runCommand(commandId: string) {
    // Map command ids to the existing trigger-* events the editor already
    // listens for. New ids that don't map cleanly fall through to a
    // dedicated `command-<id>` CustomEvent for future hooks.
    const triggerMap: Record<string, string> = {
        'edit.undo': 'trigger-undo',
        'edit.redo': 'trigger-redo',
        'format.highlight': 'trigger-highlight',
        'format.code': 'trigger-inline-code',
        'insert.image-upload': 'trigger-image-upload',
        'insert.drawing': 'trigger-insert-drawing',
        'insert.checklist': 'trigger-checklist',
        'insert.hr': 'trigger-hr',
        'insert.template': 'trigger-templates',
        'insert.prompt': 'trigger-prompts',
        'view.search': 'trigger-search',
        'view.focus-mode': 'trigger-focus',
        'view.split': 'trigger-split',
    };
    const ev = triggerMap[commandId];
    if (ev) {
        window.dispatchEvent(new Event(ev));
        return;
    }
    window.dispatchEvent(new CustomEvent('tj-command', { detail: { commandId } }));
}

export default function CommandDispatcher({ runner = runCommand }: { runner?: CommandRunner }) {
    const overridesRef = useRef<Record<string, string | null>>({});

    useEffect(() => {
        const load = async () => {
            try {
                if (typeof window !== 'undefined' && window.electron?.getSettings) {
                    const s = await window.electron.getSettings();
                    const k = (s?.keybindings as Record<string, string | null> | undefined) ?? {};
                    overridesRef.current = { ...k };
                } else {
                    const raw = localStorage.getItem('keybindings');
                    overridesRef.current = raw ? JSON.parse(raw) : {};
                }
            } catch { /* silence */ }
        };
        load();
        const onSettings = () => load();
        window.addEventListener('settings-changed', onSettings);
        return () => window.removeEventListener('settings-changed', onSettings);
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // If ProseMirror (or any earlier handler) already handled this
            // key, bail — re-dispatching `trigger-undo` / `trigger-inline-code`
            // / etc. would double-fire the action (e.g. two undos for a single
            // Ctrl+Z). The TipTap StarterKit's history & marks keymap calls
            // preventDefault on success.
            if (e.defaultPrevented) return;

            for (const cmd of COMMANDS) {
                const binding = resolveBindingForCommand(cmd.id, overridesRef.current);
                if (!binding) continue;
                if (eventMatchesBinding(e, binding)) {
                    // Only intercept if focus isn't inside a text-input
                    // surface — single-letter and Shift+letter bindings
                    // shouldn't hijack ordinary typing. We check three
                    // surfaces: <input>, <textarea>, and any contenteditable
                    // ancestor (covers ProseMirror's editor root, which
                    // uses a contenteditable div).
                    const parts = binding.split('+');
                    const hasRealModifier = parts.some(p => p === 'Ctrl' || p === 'Alt' || p === 'Meta')
                        || /^F\d+$/.test(parts[parts.length - 1]);
                    const target = e.target as HTMLElement | null;
                    const tag = target?.tagName?.toLowerCase();
                    const inFormField = tag === 'input' || tag === 'textarea';
                    const inEditable = !!target?.closest?.('[contenteditable="true"], [contenteditable=""]');
                    if (!hasRealModifier && (inFormField || inEditable)) continue;

                    e.preventDefault();
                    runner(cmd.id);
                    break;
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [runner]);

    return null;
}
