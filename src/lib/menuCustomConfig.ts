/**
 * Web-side persistence for menu customization (the pure filtering algorithm
 * lives in menuCustomization.js). Stores the hidden-item id set in localStorage
 * and notifies the open MenuBar to re-read, mirroring toolbarConfig. On
 * Electron the same set is also written to settings.json so the native menu
 * (rebuilt in main.js) stays in sync.
 */

export const MENU_CONFIG_KEY = 'menuHiddenItems';
export const MENU_CONFIG_EVENT = 'menu-config-changed';

export function loadMenuHidden(): Set<string> {
    if (typeof localStorage === 'undefined') return new Set();
    try {
        const arr = JSON.parse(localStorage.getItem(MENU_CONFIG_KEY) || '[]');
        if (Array.isArray(arr)) return new Set(arr.filter((s): s is string => typeof s === 'string'));
    } catch { /* corrupt — start empty */ }
    return new Set();
}

export function saveMenuHidden(hidden: ReadonlySet<string>): void {
    const arr = [...hidden];
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(MENU_CONFIG_KEY, JSON.stringify(arr));
    }
    // Keep the Electron native menu in sync; harmless no-op on web.
    const w = globalThis as unknown as { electron?: { saveSetting: (k: string, v: unknown) => void } };
    try { w.electron?.saveSetting(MENU_CONFIG_KEY, arr); } catch { /* ignore */ }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(MENU_CONFIG_EVENT));
}
