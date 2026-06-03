/**
 * User menu customization (J8 lets users tailor the menus). Given the shared
 * `J8_MENUS` spec and a set of hidden item ids, produce the EFFECTIVE menu tree
 * that both targets render: the web MenuBar and the Electron native menu build
 * from the same filtered spec, so they stay identical.
 *
 * Identity is the full label path (e.g. "FilePrint Setup…") so hiding one
 * command can't accidentally hide another that happens to share an `action`
 * (several leaves reuse actions like "search"/"replace"). Hiding only affects
 * the MENU; keyboard accelerators stay bound (the command dispatcher is
 * independent), which matches the expectation that a hidden item is still
 * reachable by its shortcut.
 *
 * Only show/hide is offered — not reorder. CommonJS so main.js can require it;
 * types live in the sibling menuCustomization.d.ts.
 */

const SEP = '';

/** Stable id for a menu node given the labels from the top menu down to it. */
function menuItemId(path) {
    return path.join(SEP);
}

function isSeparator(n) {
    return n && n.separator === true;
}

// Drop leading/trailing separators and collapse consecutive ones so removing
// items never leaves a dangling or doubled divider.
function tidySeparators(nodes) {
    const out = [];
    for (const n of nodes) {
        if (isSeparator(n)) {
            if (out.length === 0 || isSeparator(out[out.length - 1])) continue;
            out.push(n);
        } else {
            out.push(n);
        }
    }
    while (out.length && isSeparator(out[out.length - 1])) out.pop();
    return out;
}

function filterNodes(nodes, prefix, hidden) {
    const kept = [];
    for (const n of nodes) {
        if (isSeparator(n)) { kept.push(n); continue; }
        const id = menuItemId([...prefix, n.label]);
        if (hidden.has(id)) continue;
        if (Array.isArray(n.submenu)) {
            const sub = tidySeparators(filterNodes(n.submenu, [...prefix, n.label], hidden));
            if (sub.length === 0) continue; // an emptied submenu is dropped
            kept.push({ ...n, submenu: sub });
        } else {
            kept.push(n);
        }
    }
    return kept;
}

/**
 * Apply a hidden-id set to the menu spec, returning a filtered deep copy.
 * Empty top menus are dropped; separators are tidied at every level.
 */
function applyMenuCustomization(menus, hiddenIds) {
    const hidden = hiddenIds instanceof Set ? hiddenIds : new Set(hiddenIds || []);
    const out = [];
    for (const menu of menus) {
        if (hidden.has(menuItemId([menu.label]))) continue;
        const submenu = tidySeparators(filterNodes(menu.submenu, [menu.label], hidden));
        if (submenu.length === 0) continue;
        out.push({ ...menu, submenu });
    }
    return out;
}

/**
 * Flatten the spec into a list of toggleable rows for a settings UI:
 * `{ id, label, depth, isMenu }` (separators excluded). Top menus have depth 0.
 */
function listMenuItems(menus) {
    const rows = [];
    const walk = (nodes, prefix, depth) => {
        for (const n of nodes) {
            if (isSeparator(n)) continue;
            const id = menuItemId([...prefix, n.label]);
            const isMenu = Array.isArray(n.submenu);
            rows.push({ id, label: n.label, depth, isMenu });
            if (isMenu) walk(n.submenu, [...prefix, n.label], depth + 1);
        }
    };
    for (const menu of menus) {
        rows.push({ id: menuItemId([menu.label]), label: menu.label, depth: 0, isMenu: true });
        walk(menu.submenu, [menu.label], 1);
    }
    return rows;
}

module.exports = { menuItemId, applyMenuCustomization, listMenuItems };
