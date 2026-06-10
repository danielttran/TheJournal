"use client";

/**
 * Web application menu bar — renders the SAME `J8_MENUS` spec the Electron
 * native menu uses, so the two are identical. Rendered only on the web target;
 * in Electron the OS-native menu (built in main.js from the same spec) is used
 * instead, exactly like David RM "The Journal 8".
 *
 * Each leaf dispatches its action. Most actions become a `trigger-<action>`
 * window event consumed by handlers across the app (Editor / Sidebar /
 * JournalView / TabBar / GlobalIPCManager). Native roles (undo/cut/…) fall back
 * to execCommand; a few items are web-specific routes (downloads, external links).
 */

import { useEffect, useRef, useState } from 'react';
import { J8_MENUS, type MenuNode, type MenuLeaf, type MenuTop } from '@/lib/menuSpec';
import { applyMenuCustomization } from '@/lib/menuCustomization';
import { loadMenuHidden, MENU_CONFIG_EVENT } from '@/lib/menuCustomConfig';
import { resolveWebMenuAction, isAccelShownOnWeb } from '@/lib/menuActions';
import { logAction } from '@/lib/actionLog';

function humanAccel(accel?: string): string {
    if (!accel) return '';
    return accel
        .replace(/CmdOrCtrl|CommandOrControl/g, 'Ctrl')
        .replace(/Cmd|Command/g, 'Ctrl')
        .replace(/Return/g, 'Enter')
        .replace(/\+/g, '+');
}

function isLeaf(n: MenuNode): n is MenuLeaf {
    return !('separator' in n);
}

/** Run a web menu action. Returns nothing; closes the menu via the caller. */
function runAction(node: MenuLeaf) {
    const r = resolveWebMenuAction(node);
    logAction('menu bar', node.action ?? node.label, r);
    switch (r.kind) {
        case 'role':
            try { document.execCommand(r.role === 'selectAll' ? 'selectAll' : r.role); }
            catch { /* browsers gate programmatic paste; the native Ctrl+key still works */ }
            return;
        case 'event': window.dispatchEvent(r.detail !== undefined ? new CustomEvent(r.event, { detail: r.detail }) : new Event(r.event)); return;
        case 'plugin': window.dispatchEvent(new CustomEvent('trigger-run-plugin', { detail: { id: r.id } })); return;
        case 'open': window.open(r.url, '_blank'); return;
        case 'close': window.close(); return;
        case 'info': window.alert(r.message); return;
    }
}

function Flyout({ nodes, onRun }: { nodes: MenuNode[]; onRun: () => void }) {
    return (
        <div className="min-w-[230px] py-1 bg-bg-card border border-border-primary rounded-md shadow-xl">
            {nodes.map((n, i) => {
                if (!isLeaf(n)) return <div key={i} className="my-1 border-t border-border-primary" />;
                if (n.submenu) {
                    return (
                        <div key={i} className="relative group/sub">
                            <div className="flex items-center justify-between px-3 py-1.5 text-sm text-text-primary hover:bg-accent-primary hover:text-white cursor-default">
                                <span>{n.label}</span>
                                <span className="ml-4 opacity-60">›</span>
                            </div>
                            <div className="absolute left-full top-0 -mt-1 hidden group-hover/sub:block z-[510]">
                                <Flyout nodes={n.submenu} onRun={onRun} />
                            </div>
                        </div>
                    );
                }
                return (
                    <button
                        key={i}
                        onClick={() => { runAction(n); onRun(); }}
                        className="w-full text-left flex items-center justify-between px-3 py-1.5 text-sm text-text-primary hover:bg-accent-primary hover:text-white"
                    >
                        <span>{n.label}</span>
                        {n.accel && isAccelShownOnWeb(n.accel) && <kbd className="ml-6 text-[10px] opacity-60 font-sans">{humanAccel(n.accel)}</kbd>}
                    </button>
                );
            })}
        </div>
    );
}

export default function MenuBar() {
    const [openIdx, setOpenIdx] = useState<number | null>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const [isElectron, setIsElectron] = useState(false);
    // User menu customization (hidden items). Re-read on the config event so
    // toggling in Settings updates the bar live (mirrors toolbar-config-changed).
    const [menus, setMenus] = useState<MenuTop[]>(J8_MENUS);

    useEffect(() => { setIsElectron(typeof window !== 'undefined' && !!window.electron); }, []);

    useEffect(() => {
        const refresh = () => setMenus(applyMenuCustomization(J8_MENUS, loadMenuHidden()));
        refresh();
        window.addEventListener(MENU_CONFIG_EVENT, refresh);
        return () => window.removeEventListener(MENU_CONFIG_EVENT, refresh);
    }, []);

    useEffect(() => {
        if (openIdx === null) return;
        const onDown = (e: MouseEvent) => {
            if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenIdx(null);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [openIdx]);

    // Electron shows the OS-native menu (built from the same spec); no in-app bar.
    if (isElectron) return null;

    return (
        <div ref={barRef} className="flex items-center h-8 px-1 bg-bg-sidebar border-b border-border-primary select-none text-text-secondary text-sm flex-shrink-0">
            {menus.map((menu, idx) => (
                <div key={menu.label} className="relative">
                    <button
                        onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                        onMouseEnter={() => { if (openIdx !== null) setOpenIdx(idx); }}
                        className={`px-3 py-1 rounded ${openIdx === idx ? 'bg-bg-hover text-text-primary' : 'hover:bg-bg-hover hover:text-text-primary'}`}
                    >
                        {menu.label}
                    </button>
                    {openIdx === idx && (
                        <div className="absolute left-0 top-full mt-0.5 z-[500]">
                            <Flyout nodes={menu.submenu} onRun={() => setOpenIdx(null)} />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
