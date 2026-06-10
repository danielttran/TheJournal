"use client";

import { useEffect, useRef } from 'react';
import { COMMANDS, eventMatchesBinding, resolveBindingForCommand } from '@/lib/commands';
import { COMMAND_TRIGGER_MAP } from '@/lib/commandTriggers';
import { logAction } from '@/lib/actionLog';

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
    // listens for (COMMAND_TRIGGER_MAP — pure + test-guarded: EVERY command id
    // maps, so a keybinding can never dispatch into the void).
    const ev = COMMAND_TRIGGER_MAP[commandId];
    if (!ev) return;
    logAction('keyboard', commandId, { event: ev });
    window.dispatchEvent(new Event(ev));
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
