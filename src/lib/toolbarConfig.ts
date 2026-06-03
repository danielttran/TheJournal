/**
 * Editor toolbar customization (J8 "Customize Toolbar"). The toolbar is a fixed
 * sequence of visual groups; users can hide groups they don't use. Kept pure +
 * DOM-light (only touches localStorage) so the show/hide maths is unit-tested
 * and the toolbar component stays a thin consumer.
 *
 * Reordering is intentionally NOT offered: the toolbar interleaves contextual
 * controls (image-resize, plugin buttons, a flex spacer) whose position is
 * meaningful, so only visibility is user-configurable.
 */

export interface ToolbarGroup {
    id: string;
    label: string;
}

/** Canonical group order, matching the toolbar's left-to-right layout. */
export const TOOLBAR_GROUPS: ToolbarGroup[] = [
    { id: 'font', label: 'Font & color' },
    { id: 'marks', label: 'Bold / italic / sub-super' },
    { id: 'style', label: 'Paragraph style' },
    { id: 'lists', label: 'Lists & indent' },
    { id: 'align', label: 'Alignment & line spacing' },
    { id: 'blocks', label: 'Code, quote, divider & table' },
    { id: 'insert', label: 'Image, link & attachment' },
    { id: 'tools', label: 'Date, bookmarks & symbols' },
    { id: 'history', label: 'Undo / redo / clear' },
];

const GROUP_IDS = new Set(TOOLBAR_GROUPS.map(g => g.id));
export const TOOLBAR_CONFIG_KEY = 'toolbarHiddenGroups';
export const TOOLBAR_CONFIG_EVENT = 'toolbar-config-changed';

/** A set of group ids the user has hidden. Empty = the default (all visible). */
export type ToolbarConfig = ReadonlySet<string>;

/** Parse a stored JSON array into a validated hidden-group set (junk-safe). */
export function parseToolbarConfig(raw: string | null): ToolbarConfig {
    if (!raw) return new Set();
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.filter(id => typeof id === 'string' && GROUP_IDS.has(id)));
    } catch {
        return new Set();
    }
}

export function serializeToolbarConfig(hidden: ToolbarConfig): string {
    // Keep canonical order so the stored value is stable/diffable.
    return JSON.stringify(TOOLBAR_GROUPS.map(g => g.id).filter(id => hidden.has(id)));
}

export function isGroupVisible(hidden: ToolbarConfig, id: string): boolean {
    // Unknown ids (e.g. always-on plugin/prompt groups) are never hidden.
    if (!GROUP_IDS.has(id)) return true;
    return !hidden.has(id);
}

/** Return a new set with `id` toggled (no mutation of the input). */
export function toggleGroup(hidden: ToolbarConfig, id: string): Set<string> {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else if (GROUP_IDS.has(id)) next.add(id);
    return next;
}

export function loadToolbarConfig(): ToolbarConfig {
    if (typeof localStorage === 'undefined') return new Set();
    return parseToolbarConfig(localStorage.getItem(TOOLBAR_CONFIG_KEY));
}

/** Persist + notify open toolbars to re-read (mirrors font-size-changed). */
export function saveToolbarConfig(hidden: ToolbarConfig): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TOOLBAR_CONFIG_KEY, serializeToolbarConfig(hidden));
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(TOOLBAR_CONFIG_EVENT));
    }
}
