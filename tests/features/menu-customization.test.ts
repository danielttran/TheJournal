import { describe, it, expect } from 'vitest';
import { J8_MENUS } from '../../src/lib/menuSpec';
import {
    menuItemId, applyMenuCustomization, listMenuItems,
} from '../../src/lib/menuCustomization';

// The spec is a discriminated union (leaf | separator). The filtered output is
// validated structurally here, so treat nodes loosely in assertions.
type AnyNode = { label?: string; separator?: true; submenu?: AnyNode[] };
type AnyMenu = { label: string; submenu: AnyNode[] };
const apply = (hidden: Set<string>) =>
    applyMenuCustomization(J8_MENUS, hidden) as unknown as AnyMenu[];
const subOf = (menus: AnyMenu[], label: string) => menus.find(m => m.label === label)!.submenu;
const leafLabels = (nodes: AnyNode[]) => nodes.filter(n => !n.separator).map(n => n.label);

describe('menuCustomization', () => {
    it('returns the full spec when nothing is hidden', () => {
        const out = apply(new Set());
        expect(out.length).toBe(J8_MENUS.length);
        expect(out.map(m => m.label)).toEqual(J8_MENUS.map(m => m.label));
    });

    it('drops a hidden top-level menu', () => {
        const out = apply(new Set([menuItemId(['Help'])]));
        expect(out.some(m => m.label === 'Help')).toBe(false);
        expect(out.some(m => m.label === 'File')).toBe(true);
    });

    it('hides one leaf by its full path, not others that share an action', () => {
        // "Find…" and "Search Across All Categories…" both use action "search";
        // hiding by path must only remove the one named item.
        const out = apply(new Set([menuItemId(['Search', 'Find…'])]));
        const labels = leafLabels(subOf(out, 'Search'));
        expect(labels).not.toContain('Find…');
        expect(labels).toContain('Search Across All Categories…');
    });

    it('drops a submenu that becomes empty after hiding all its children', () => {
        const rows = listMenuItems(J8_MENUS);
        const toolbarsChildren = rows.filter(r => r.id.startsWith(menuItemId(['View', 'Toolbars'])) && r.depth === 2);
        expect(toolbarsChildren.length).toBeGreaterThan(0);
        const out = apply(new Set(toolbarsChildren.map(r => r.id)));
        expect(subOf(out, 'View').some(n => n.label === 'Toolbars')).toBe(false);
    });

    it('tidies separators so none dangle or double up', () => {
        const out = apply(new Set([menuItemId(['File', 'New Journal Volume…'])]));
        expect(subOf(out, 'File')[0].separator).not.toBe(true);
        for (const menu of out) {
            for (let i = 1; i < menu.submenu.length; i++) {
                expect(menu.submenu[i - 1].separator === true && menu.submenu[i].separator === true).toBe(false);
            }
            expect(menu.submenu[menu.submenu.length - 1].separator).not.toBe(true);
        }
    });

    it('does not mutate the input spec', () => {
        const before = JSON.stringify(J8_MENUS);
        apply(new Set([menuItemId(['Help'])]));
        expect(JSON.stringify(J8_MENUS)).toBe(before);
    });

    it('lists every menu and leaf with stable, unique ids', () => {
        const rows = listMenuItems(J8_MENUS);
        const ids = rows.map(r => r.id);
        expect(new Set(ids).size).toBe(ids.length); // unique
        expect(rows.some(r => r.depth === 0 && r.label === 'File')).toBe(true);
        expect(rows.some(r => r.label === 'Today')).toBe(true);
    });
});
