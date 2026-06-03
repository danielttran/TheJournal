import { describe, it, expect } from 'vitest';
import {
    TOOLBAR_GROUPS,
    parseToolbarConfig,
    serializeToolbarConfig,
    isGroupVisible,
    toggleGroup,
} from '../../src/lib/toolbarConfig';

describe('toolbarConfig', () => {
    it('defaults to all groups visible (empty hidden set)', () => {
        const cfg = parseToolbarConfig(null);
        expect(cfg.size).toBe(0);
        for (const g of TOOLBAR_GROUPS) expect(isGroupVisible(cfg, g.id)).toBe(true);
    });

    it('parses a stored hidden set and drops unknown ids', () => {
        const cfg = parseToolbarConfig(JSON.stringify(['marks', 'bogus', 'history']));
        expect([...cfg].sort()).toEqual(['history', 'marks']);
        expect(isGroupVisible(cfg, 'marks')).toBe(false);
        expect(isGroupVisible(cfg, 'font')).toBe(true);
    });

    it('survives corrupt JSON', () => {
        expect(parseToolbarConfig('{not json').size).toBe(0);
        expect(parseToolbarConfig('"a string"').size).toBe(0);
    });

    it('treats unknown groups (plugins/prompts) as always visible', () => {
        const cfg = parseToolbarConfig(JSON.stringify(['font']));
        expect(isGroupVisible(cfg, 'plugins')).toBe(true);
        expect(isGroupVisible(cfg, 'prompts')).toBe(true);
    });

    it('toggles a group on and off without mutating the input', () => {
        const base = parseToolbarConfig(null);
        const hidden = toggleGroup(base, 'lists');
        expect(base.size).toBe(0);            // input untouched
        expect(hidden.has('lists')).toBe(true);
        const shown = toggleGroup(hidden, 'lists');
        expect(shown.has('lists')).toBe(false);
    });

    it('ignores toggling an unknown id', () => {
        const cfg = toggleGroup(new Set(), 'nope');
        expect(cfg.size).toBe(0);
    });

    it('serializes in canonical order regardless of insertion order', () => {
        const hidden = new Set(['history', 'font', 'marks']);
        // canonical order: font, marks, ..., history
        expect(serializeToolbarConfig(hidden)).toBe(JSON.stringify(['font', 'marks', 'history']));
    });

    it('round-trips through serialize/parse', () => {
        const hidden = new Set(['align', 'insert']);
        const cfg = parseToolbarConfig(serializeToolbarConfig(hidden));
        expect([...cfg].sort()).toEqual(['align', 'insert']);
    });
});
