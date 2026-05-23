export interface MenuLeaf {
    label: string;
    action?: string;
    role?: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'quit';
    accel?: string;
    desktopOnly?: boolean;
    submenu?: MenuNode[];
}
export interface MenuSeparator {
    separator: true;
}
export type MenuNode = MenuLeaf | MenuSeparator;
export interface MenuTop {
    label: string;
    submenu: MenuNode[];
}
export const J8_MENUS: MenuTop[];
