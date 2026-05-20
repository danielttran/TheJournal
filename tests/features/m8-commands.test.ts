/**
 * M8 — Command registry + keybinding utilities.
 *
 * The framework boils down to three pure pieces we can test:
 *  - keybinding parsing & normalization (so `ctrl+b` and `Ctrl+B` mean
 *    the same thing).
 *  - KeyboardEvent → binding-string matching.
 *  - command resolution by id with override support
 *    (resolveBindingForCommand: user override beats default).
 */
import { describe, it, expect } from 'vitest';
import {
    parseBinding,
    eventMatchesBinding,
    resolveBindingForCommand,
    COMMANDS,
} from '../../src/lib/commands';

describe('parseBinding', () => {
    it('canonicalises "ctrl+b" → "Ctrl+B"', () => {
        expect(parseBinding('ctrl+b')).toBe('Ctrl+B');
        expect(parseBinding('CTRL+B')).toBe('Ctrl+B');
        expect(parseBinding('CTRL + b')).toBe('Ctrl+B');
    });

    it('orders modifiers consistently (Ctrl, Alt, Shift, Meta, Key)', () => {
        expect(parseBinding('shift+ctrl+b')).toBe('Ctrl+Shift+B');
        expect(parseBinding('alt+shift+ctrl+meta+k')).toBe('Ctrl+Alt+Shift+Meta+K');
    });

    it('keeps function-key labels intact (F11)', () => {
        expect(parseBinding('f11')).toBe('F11');
        expect(parseBinding('F11')).toBe('F11');
    });

    it('returns null for empty / bogus input', () => {
        expect(parseBinding('')).toBeNull();
        expect(parseBinding('Ctrl+')).toBeNull();   // missing key
        expect(parseBinding('+B')).toBeNull();      // missing modifier name
    });

    it('rejects bindings with no main key', () => {
        // Multiple modifiers but no terminal key.
        expect(parseBinding('Ctrl+Shift')).toBeNull();
    });
});

describe('eventMatchesBinding', () => {
    const ev = (init: Partial<KeyboardEvent>) => init as unknown as KeyboardEvent;

    it('matches Ctrl+B', () => {
        const e = ev({ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: 'b' });
        expect(eventMatchesBinding(e, 'Ctrl+B')).toBe(true);
    });

    it('rejects partial modifier mismatch', () => {
        const e = ev({ ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: 'b' });
        expect(eventMatchesBinding(e, 'Ctrl+B')).toBe(false);
        expect(eventMatchesBinding(e, 'Ctrl+Shift+B')).toBe(true);
    });

    it('is case-insensitive on the key', () => {
        const e = ev({ ctrlKey: true, key: 'B' });
        expect(eventMatchesBinding(e, 'Ctrl+B')).toBe(true);
        expect(eventMatchesBinding(e, 'Ctrl+b')).toBe(true);
    });

    it('matches function keys', () => {
        const e = ev({ key: 'F11' });
        expect(eventMatchesBinding(e, 'F11')).toBe(true);
    });

    it('returns false for an invalid binding string', () => {
        const e = ev({ ctrlKey: true, key: 'b' });
        expect(eventMatchesBinding(e, 'asdf')).toBe(false);
    });
});

describe('COMMANDS registry', () => {
    it('exports a non-empty list with unique IDs', () => {
        expect(COMMANDS.length).toBeGreaterThan(0);
        const ids = new Set<string>();
        for (const c of COMMANDS) {
            expect(ids.has(c.id), `duplicate command id: ${c.id}`).toBe(false);
            ids.add(c.id);
        }
    });

    it('every command has a label, category, and a default binding or no-binding null', () => {
        for (const c of COMMANDS) {
            // IDs use dotted namespaces (category.action) for grouping.
            expect(c.id).toMatch(/^[a-z][a-z0-9.-]+$/);
            expect(c.label.length).toBeGreaterThan(0);
            expect(c.category.length).toBeGreaterThan(0);
            // defaultBinding may be null (e.g. "Insert image from URL" has none).
            if (c.defaultBinding != null) {
                expect(parseBinding(c.defaultBinding)).toBe(c.defaultBinding);
            }
        }
    });

    it('includes the DavidRM Ctrl+1..0 text-style commands', () => {
        const styleIds = COMMANDS.filter(c => c.id.startsWith('style.')).map(c => c.id);
        expect(styleIds.length).toBeGreaterThanOrEqual(5);
        // At least Ctrl+1..3 should exist for heading levels.
        const bindings = COMMANDS.filter(c => c.id.startsWith('style.')).map(c => c.defaultBinding);
        expect(bindings).toContain('Ctrl+1');
        expect(bindings).toContain('Ctrl+2');
        expect(bindings).toContain('Ctrl+3');
    });
});

describe('resolveBindingForCommand', () => {
    it('returns the default when no override is set', () => {
        expect(resolveBindingForCommand('format.bold', {})).toBe('Ctrl+B');
    });

    it('returns the user override when present', () => {
        expect(resolveBindingForCommand('format.bold', { 'format.bold': 'Ctrl+Shift+B' })).toBe('Ctrl+Shift+B');
    });

    it('returns null when the override clears the binding (unbind)', () => {
        expect(resolveBindingForCommand('format.bold', { 'format.bold': null })).toBeNull();
    });

    it('returns null for an unknown command id', () => {
        expect(resolveBindingForCommand('nonexistent.command', {})).toBeNull();
    });
});
