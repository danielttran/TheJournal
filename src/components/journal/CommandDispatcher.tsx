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
            for (const cmd of COMMANDS) {
                const binding = resolveBindingForCommand(cmd.id, overridesRef.current);
                if (!binding) continue;
                if (eventMatchesBinding(e, binding)) {
                    // Only intercept if focus isn't inside an input/textarea
                    // unless the binding starts with Ctrl/Alt/Meta — single-key
                    // bindings shouldn't hijack ordinary typing.
                    const parts = binding.split('+');
                    const hasModifier = parts.length > 1 || /^F\d+$/.test(parts[0]);
                    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
                    const inField = tag === 'input' || tag === 'textarea';
                    if (!hasModifier && inField) continue;

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
