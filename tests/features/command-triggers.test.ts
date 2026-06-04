/**
 * Guards that command-registry ids stay wired to a dispatch target.
 * Regression: the style.* paragraph shortcuts (Ctrl+1/2/3/0/9, Ctrl+Shift+C)
 * were registered as commands but had no entry in the dispatcher's trigger map,
 * so the keybindings dispatched into a dead `tj-command` on both web and
 * Electron. The Format MENU worked (it fires trigger-style-* directly); only
 * the keyboard path was dead.
 */
import { describe, it, expect } from 'vitest';
import { COMMANDS } from '../../src/lib/commands';
import { COMMAND_TRIGGER_MAP } from '../../src/lib/commandTriggers';

describe('command trigger wiring', () => {
    it('every style.* paragraph command maps to its editor trigger event', () => {
        expect(COMMAND_TRIGGER_MAP['style.heading-1']).toBe('trigger-style-h1');
        expect(COMMAND_TRIGGER_MAP['style.heading-2']).toBe('trigger-style-h2');
        expect(COMMAND_TRIGGER_MAP['style.heading-3']).toBe('trigger-style-h3');
        expect(COMMAND_TRIGGER_MAP['style.paragraph']).toBe('trigger-style-normal');
        expect(COMMAND_TRIGGER_MAP['style.blockquote']).toBe('trigger-style-quote');
        expect(COMMAND_TRIGGER_MAP['style.code-block']).toBe('trigger-style-code');
    });

    it('every command WITH a default keybinding has a dispatch path', () => {
        // Commands handled outside the trigger map: TipTap StarterKit marks
        // (bold/italic/underline/strikethrough), the editor's own Ctrl+F find,
        // and LockGate's hardcoded lock shortcut.
        const handledElsewhere = new Set([
            'format.bold', 'format.italic', 'format.underline', 'format.strikethrough',
            'edit.find', 'security.lock',
        ]);
        const unwired = COMMANDS
            .filter(c => c.defaultBinding && !handledElsewhere.has(c.id))
            .filter(c => !COMMAND_TRIGGER_MAP[c.id])
            .map(c => c.id);
        expect(unwired, `commands with a keybinding but no dispatch target: ${unwired.join(', ')}`).toEqual([]);
    });

    it('maps only to non-empty event names and references real command ids', () => {
        const ids = new Set(COMMANDS.map(c => c.id));
        for (const [cmdId, ev] of Object.entries(COMMAND_TRIGGER_MAP)) {
            expect(ev.length, `${cmdId} maps to empty event`).toBeGreaterThan(0);
            expect(ids.has(cmdId), `trigger map references unknown command ${cmdId}`).toBe(true);
        }
    });
});
