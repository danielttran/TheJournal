// @vitest-environment jsdom
/**
 * GUI-level verification: renders the actual <MenuBar/>, opens every top menu,
 * clicks every leaf item, and asserts the correct side-effect fires. This is
 * the "click through the rendered menus" check — done headlessly in jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import MenuBar from '../../src/components/journal/MenuBar';
import { J8_MENUS, type MenuNode, type MenuLeaf } from '../../src/lib/menuSpec';
import { resolveWebMenuAction } from '../../src/lib/menuActions';

function leaves(nodes: MenuNode[]): MenuLeaf[] {
    const out: MenuLeaf[] = [];
    for (const n of nodes) {
        if ('separator' in n) continue;
        if (n.submenu) out.push(...leaves(n.submenu));
        else out.push(n);
    }
    return out;
}

let dispatchSpy: ReturnType<typeof vi.spyOn>;
let openSpy: ReturnType<typeof vi.spyOn>;
let alertSpy: ReturnType<typeof vi.spyOn>;
let execSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    execSpy = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = execSpy;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('MenuBar (rendered, clicked)', () => {
    it('renders all 13 top-level menus', () => {
        const { getByText, unmount } = render(React.createElement(MenuBar));
        for (const m of J8_MENUS) expect(getByText(m.label)).toBeTruthy();
        unmount();
    });

    it('clicking every menu item fires its resolved behaviour (no dead clicks)', () => {
        for (const menu of J8_MENUS) {
            for (const leaf of leaves(menu.submenu)) {
                const { getByText, getAllByText, container, unmount } = render(React.createElement(MenuBar));
                // open the top menu
                fireEvent.click(getByText(menu.label));
                // the leaf button lives inside the now-open dropdown (submenus are
                // CSS-hidden but mounted in the DOM, so clicks still dispatch)
                const matches = within(container).getAllByText(leaf.label);
                const btn = matches.find(el => el.tagName === 'BUTTON') ?? matches[matches.length - 1];
                dispatchSpy.mockClear(); openSpy.mockClear(); alertSpy.mockClear(); execSpy.mockClear();
                fireEvent.click(btn);

                const r = resolveWebMenuAction(leaf);
                if (r.kind === 'event') {
                    const types = dispatchSpy.mock.calls.map((c: unknown[]) => (c[0] as Event).type);
                    expect(types, `${menu.label} › ${leaf.label}`).toContain(r.event);
                } else if (r.kind === 'plugin') {
                    const types = dispatchSpy.mock.calls.map((c: unknown[]) => (c[0] as Event).type);
                    expect(types, `${menu.label} › ${leaf.label}`).toContain('trigger-run-plugin');
                } else if (r.kind === 'open') {
                    expect(openSpy, `${menu.label} › ${leaf.label}`).toHaveBeenCalled();
                } else if (r.kind === 'role') {
                    expect(execSpy, `${menu.label} › ${leaf.label}`).toHaveBeenCalled();
                } else if (r.kind === 'info') {
                    expect(alertSpy, `${menu.label} › ${leaf.label}`).toHaveBeenCalled();
                }
                // void getAllByText to keep it referenced
                void getAllByText;
                unmount();
            }
        }
    });

    it('Install Plugin click opens Settings (the previously-broken web case)', () => {
        const { getByText, container, unmount } = render(React.createElement(MenuBar));
        fireEvent.click(getByText('Plugins'));
        dispatchSpy.mockClear();
        // label lives in a <span> inside the button; the click bubbles to onClick
        fireEvent.click(within(container).getByText('Install Plugin…'));
        const types = dispatchSpy.mock.calls.map((c: unknown[]) => (c[0] as Event).type);
        expect(types).toContain('trigger-settings');
        unmount();
    });

    it('a Plugins-menu item runs the plugin (trigger-run-plugin)', () => {
        const { getByText, container, unmount } = render(React.createElement(MenuBar));
        fireEvent.click(getByText('Plugins'));
        dispatchSpy.mockClear();
        fireEvent.click(within(container).getByText('Insert Draw.io Diagram'));
        const evts = dispatchSpy.mock.calls.map((c: unknown[]) => c[0] as Event);
        const runPlugin = evts.find((e: Event) => e.type === 'trigger-run-plugin') as CustomEvent | undefined;
        expect(runPlugin).toBeTruthy();
        expect((runPlugin?.detail as { id?: string })?.id).toBe('drawio');
        unmount();
    });
});
