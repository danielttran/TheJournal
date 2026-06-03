import type { MenuTop } from './menuSpec';

export interface MenuItemRow {
    id: string;
    label: string;
    depth: number;
    isMenu: boolean;
}

/** Stable id for a menu node given the labels from the top menu down to it. */
export function menuItemId(path: string[]): string;

/** Apply a hidden-id set to the menu spec, returning a filtered deep copy. */
export function applyMenuCustomization(
    menus: MenuTop[], hiddenIds: ReadonlySet<string> | string[],
): MenuTop[];

/** Flatten the spec into toggleable rows for a settings UI (separators excluded). */
export function listMenuItems(menus: MenuTop[]): MenuItemRow[];
