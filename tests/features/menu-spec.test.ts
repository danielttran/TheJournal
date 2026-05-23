import { describe, it, expect } from 'vitest';
import { J8_MENUS, type MenuNode, type MenuLeaf } from '../../src/lib/menuSpec';

function leaves(nodes: MenuNode[]): MenuLeaf[] {
    const out: MenuLeaf[] = [];
    for (const n of nodes) {
        if ('separator' in n) continue;
        if (n.submenu) out.push(...leaves(n.submenu));
        else out.push(n);
    }
    return out;
}

describe('J8 menu spec', () => {
    it('has exactly the owner-specified top-level menus, in order', () => {
        expect(J8_MENUS.map(m => m.label)).toEqual([
            'File', 'Edit', 'Search', 'View', 'Go', 'Insert', 'Format',
            'Topic', 'Entry', 'Category', 'User', 'Tools', 'Plugins', 'Help',
        ]);
    });

    it('every leaf item has an action and a non-empty label', () => {
        for (const m of J8_MENUS) {
            for (const leaf of leaves(m.submenu)) {
                expect(leaf.label.trim()).not.toBe('');
                expect(typeof leaf.action).toBe('string');
                expect((leaf.action as string).length).toBeGreaterThan(0);
            }
        }
    });

    it('no two distinct items share the same accelerator (no hotkey conflicts)', () => {
        const byAccel = new Map<string, Set<string>>();
        for (const m of J8_MENUS) {
            for (const leaf of leaves(m.submenu)) {
                if (!leaf.accel) continue;
                const set = byAccel.get(leaf.accel) ?? new Set<string>();
                set.add(leaf.action as string);
                byAccel.set(leaf.accel, set);
            }
        }
        const conflicts = [...byAccel.entries()].filter(([, actions]) => actions.size > 1);
        expect(conflicts.map(([a, s]) => `${a}: ${[...s].join('/')}`)).toEqual([]);
    });

    it('places redistributed items in their owner-specified menus', () => {
        const sub = (label: string) => {
            const m = J8_MENUS.find(x => x.label === label)!;
            return leaves(m.submenu).map(l => l.action);
        };
        // Find/Replace live under Search, not Edit.
        expect(sub('Search')).toEqual(expect.arrayContaining(['search', 'find-next', 'replace']));
        expect(sub('Edit')).not.toContain('search');
        // User Accounts is its own top-level menu.
        expect(sub('User')).toEqual(expect.arrayContaining(['switch-user', 'manage-users', 'change-password', 'auto-login']));
        // Topic menu exists with assign + manage.
        expect(sub('Topic')).toEqual(['assign-topics', 'manage-topics']);
        // File keeps the Journal Volume Maintenance submenu.
        const file = J8_MENUS.find(m => m.label === 'File')!;
        const fileSubLabels = file.submenu.filter((n): n is MenuLeaf => !('separator' in n)).map(n => n.label);
        expect(fileSubLabels).toContain('Journal Volume Maintenance');
    });
});
