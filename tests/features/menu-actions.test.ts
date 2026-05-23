import { describe, it, expect } from 'vitest';
import { J8_MENUS, type MenuNode, type MenuLeaf } from '../../src/lib/menuSpec';
import { resolveWebMenuAction, HANDLED_WEB_EVENTS } from '../../src/lib/menuActions';

function leaves(nodes: MenuNode[]): MenuLeaf[] {
    const out: MenuLeaf[] = [];
    for (const n of nodes) {
        if ('separator' in n) continue;
        if (n.submenu) out.push(...leaves(n.submenu));
        else out.push(n);
    }
    return out;
}

const ALL_LEAVES = J8_MENUS.flatMap(m => leaves(m.submenu));

describe('every menu item resolves to a real behaviour on web (no dead items)', () => {
    it('resolves each leaf to a known kind', () => {
        for (const leaf of ALL_LEAVES) {
            const r = resolveWebMenuAction(leaf);
            expect(['role', 'event', 'plugin', 'open', 'info', 'close']).toContain(r.kind);
        }
    });

    it('Plugins menu items resolve to a plugin run with a non-empty id', () => {
        for (const action of ['run-plugin-drawio', 'run-plugin-sentence-diagrammer']) {
            const leaf = ALL_LEAVES.find(l => l.action === action)!;
            const r = resolveWebMenuAction(leaf);
            expect(r.kind).toBe('plugin');
            if (r.kind === 'plugin') expect(r.id.length).toBeGreaterThan(0);
        }
    });

    it('every resolved trigger event has a registered handler', () => {
        const orphans: string[] = [];
        for (const leaf of ALL_LEAVES) {
            const r = resolveWebMenuAction(leaf);
            if (r.kind === 'event' && !HANDLED_WEB_EVENTS.has(r.event)) {
                orphans.push(`${leaf.label} → ${r.event}`);
            }
        }
        expect(orphans).toEqual([]);
    });

    it('open/info results carry non-empty payloads', () => {
        for (const leaf of ALL_LEAVES) {
            const r = resolveWebMenuAction(leaf);
            if (r.kind === 'open') expect(r.url.length).toBeGreaterThan(0);
            if (r.kind === 'info') expect(r.message.length).toBeGreaterThan(0);
        }
    });

    it('install-plugin works on web (opens Settings → Plugins), not a desktop-only failure', () => {
        const install = ALL_LEAVES.find(l => l.action === 'install-plugin')!;
        expect(resolveWebMenuAction(install)).toEqual({ kind: 'event', event: 'trigger-settings' });
        expect(HANDLED_WEB_EVENTS.has('trigger-settings')).toBe(true);
    });

    it('clipboard/undo items use native roles', () => {
        for (const action of ['undo', 'redo', 'cut', 'copy', 'paste', 'select-all', 'exit']) {
            const leaf = ALL_LEAVES.find(l => l.action === action)!;
            const r = resolveWebMenuAction(leaf);
            expect(['role', 'close']).toContain(r.kind);
        }
    });
});
