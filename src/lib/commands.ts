/**
 * Central command registry.
 *
 * Every user-invocable editor action (bold, insert image, open search,
 * apply heading-1, …) lives here with a stable id, default keyboard
 * binding, and category for grouping in the settings UI.
 *
 * The renderer's global keybinding dispatcher walks this list (overlaid
 * with the user's overrides from Settings.keybindings) and dispatches
 * to the matching command's runner when the binding is hit.
 *
 * This file owns NO references to React or the editor — it's pure data
 * + parsing helpers so vitest can exercise it without a DOM.
 */

export type CommandCategory =
    | 'Edit'
    | 'Format'
    | 'Insert'
    | 'View'
    | 'Navigation'
    | 'Security';

export interface CommandDef {
    id: string;
    label: string;
    category: CommandCategory;
    /**
     * Canonical binding string, e.g. "Ctrl+B". null means the command
     * exists but has no default keyboard shortcut.
     */
    defaultBinding: string | null;
    /**
     * Optional description shown in the settings UI.
     */
    description?: string;
}

export const COMMANDS: CommandDef[] = [
    // ── Edit ─────────────────────────────────────────────────────────
    { id: 'edit.undo',  label: 'Undo',  category: 'Edit', defaultBinding: 'Ctrl+Z' },
    { id: 'edit.redo',  label: 'Redo',  category: 'Edit', defaultBinding: 'Ctrl+Y' },
    // No default: Ctrl+F is the global search (view.search) by documented
    // design; the in-entry find bar opens via F3 / the Search menu.
    { id: 'edit.find',  label: 'Find in entry',  category: 'Edit', defaultBinding: null },
    { id: 'edit.find-next', label: 'Find next', category: 'Edit', defaultBinding: 'F3' },
    { id: 'edit.replace', label: 'Replace',  category: 'Edit', defaultBinding: 'Ctrl+H' },
    { id: 'edit.paste-special', label: 'Paste as plain text', category: 'Edit', defaultBinding: 'Ctrl+Shift+V' },
    { id: 'entry.save', label: 'Save entry', category: 'Edit', defaultBinding: 'Ctrl+S' },
    { id: 'entry.properties', label: 'Entry properties…', category: 'Edit', defaultBinding: null },

    // ── Format ───────────────────────────────────────────────────────
    { id: 'format.bold',          label: 'Bold',           category: 'Format', defaultBinding: 'Ctrl+B' },
    { id: 'format.italic',        label: 'Italic',         category: 'Format', defaultBinding: 'Ctrl+I' },
    { id: 'format.underline',     label: 'Underline',      category: 'Format', defaultBinding: 'Ctrl+U' },
    { id: 'format.strikethrough', label: 'Strikethrough',  category: 'Format', defaultBinding: 'Ctrl+Shift+S' },
    { id: 'format.code',          label: 'Inline code',    category: 'Format', defaultBinding: 'Ctrl+E' },
    { id: 'format.highlight',     label: 'Highlight',      category: 'Format', defaultBinding: 'Ctrl+Shift+H' },
    { id: 'format.clear',         label: 'Clear formatting', category: 'Format', defaultBinding: null },

    // ── Text styles (DavidRM Ctrl+1..0) ──────────────────────────────
    { id: 'style.heading-1',  label: 'Heading 1',   category: 'Format', defaultBinding: 'Ctrl+1' },
    { id: 'style.heading-2',  label: 'Heading 2',   category: 'Format', defaultBinding: 'Ctrl+2' },
    { id: 'style.heading-3',  label: 'Heading 3',   category: 'Format', defaultBinding: 'Ctrl+3' },
    { id: 'style.paragraph',  label: 'Body text',   category: 'Format', defaultBinding: 'Ctrl+0' },
    { id: 'style.blockquote', label: 'Block quote', category: 'Format', defaultBinding: 'Ctrl+9' },
    { id: 'style.code-block', label: 'Code block',  category: 'Format', defaultBinding: 'Ctrl+Shift+C' },

    // ── Insert ───────────────────────────────────────────────────────
    { id: 'insert.image-upload',   label: 'Upload image…',   category: 'Insert', defaultBinding: 'Ctrl+Shift+I' },
    { id: 'insert.image-url',      label: 'Insert image by URL', category: 'Insert', defaultBinding: null },
    { id: 'insert.drawing',        label: 'New drawing',     category: 'Insert', defaultBinding: null },
    { id: 'insert.link',           label: 'Insert link',     category: 'Insert', defaultBinding: 'Ctrl+K' },
    { id: 'insert.bookmark',       label: 'Insert bookmark', category: 'Insert', defaultBinding: null },
    { id: 'insert.hr',             label: 'Horizontal rule', category: 'Insert', defaultBinding: null },
    { id: 'insert.special-char',   label: 'Special character…', category: 'Insert', defaultBinding: null },
    { id: 'insert.attachment',     label: 'File attachment…',  category: 'Insert', defaultBinding: null },
    { id: 'entry.new-subentry',    label: 'New sub-entry',     category: 'Insert', defaultBinding: 'Ctrl+Shift+Enter' },
    { id: 'insert.datetime',       label: 'Insert date & time', category: 'Insert', defaultBinding: null },
    { id: 'insert.checklist',      label: 'Checklist',       category: 'Insert', defaultBinding: null },
    { id: 'insert.template',       label: 'Insert from template…', category: 'Insert', defaultBinding: 'Ctrl+Shift+T' },
    { id: 'insert.prompt',         label: 'Insert writing prompt…', category: 'Insert', defaultBinding: null },

    // ── View ─────────────────────────────────────────────────────────
    { id: 'view.search',         label: 'Open search',         category: 'View', defaultBinding: 'Ctrl+F' },
    { id: 'view.search-all',     label: 'Search across all categories', category: 'View', defaultBinding: 'Ctrl+Shift+F' },
    { id: 'view.toggle-theme',   label: 'Toggle light / dark theme', category: 'View', defaultBinding: 'Ctrl+Shift+D' },
    { id: 'view.focus-mode',     label: 'Focus mode',          category: 'View', defaultBinding: 'F11' },
    { id: 'view.split',          label: 'Toggle split editor', category: 'View', defaultBinding: 'Ctrl+\\' },
    { id: 'view.toggle-sidebar', label: 'Show / hide sidebar',  category: 'View', defaultBinding: 'Ctrl+Shift+B' },
    { id: 'view.sidebar-side',   label: 'Move sidebar left / right', category: 'View', defaultBinding: null },
    { id: 'view.toggle-toolbar', label: 'Show / hide formatting toolbar', category: 'View', defaultBinding: null },

    // ── Navigation (David RM Go menu) ────────────────────────────────
    // Note: J8 desktop uses Ctrl+Left/Right for prev/next entry; on the web
    // those move the caret by word inside the editor, so we use Ctrl+PageUp /
    // Ctrl+PageDown instead (documented in docs/j8-gap-analysis.md).
    { id: 'nav.today',       label: 'Go to today',     category: 'Navigation', defaultBinding: 'Ctrl+T' },
    { id: 'nav.go-to-date',  label: 'Go to date…',     category: 'Navigation', defaultBinding: 'Ctrl+G' },
    { id: 'nav.prev-entry',  label: 'Previous entry',  category: 'Navigation', defaultBinding: 'Ctrl+Pageup' },
    { id: 'nav.next-entry',  label: 'Next entry',      category: 'Navigation', defaultBinding: 'Ctrl+Pagedown' },
    { id: 'nav.back',        label: 'Back',            category: 'Navigation', defaultBinding: 'Alt+Arrowleft' },
    { id: 'nav.forward',     label: 'Forward',         category: 'Navigation', defaultBinding: 'Alt+Arrowright' },
    // Category (tab) cycling. The Electron native menu also offers
    // Ctrl+Tab / Ctrl+Shift+Tab, which browsers reserve — these web-safe
    // defaults work on both targets and remain rebindable.
    { id: 'nav.prev-category', label: 'Previous category', category: 'Navigation', defaultBinding: 'Ctrl+Alt+Pageup' },
    { id: 'nav.next-category', label: 'Next category',     category: 'Navigation', defaultBinding: 'Ctrl+Alt+Pagedown' },

    // ── Entry / Category ─────────────────────────────────────────────
    { id: 'entry.print',         label: 'Print entries', category: 'Edit', defaultBinding: 'Ctrl+P' },
    { id: 'category.properties', label: 'Category properties…', category: 'Navigation', defaultBinding: 'Ctrl+Shift+P' },

    // ── Security ─────────────────────────────────────────────────────
    { id: 'security.lock',       label: 'Lock now', category: 'Security', defaultBinding: 'Ctrl+Shift+L' },
];

// ── Keybinding parser ────────────────────────────────────────────────

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const MODIFIER_ALIASES: Record<string, string> = {
    ctrl: 'Ctrl', control: 'Ctrl',
    alt: 'Alt', option: 'Alt',
    shift: 'Shift',
    meta: 'Meta', cmd: 'Meta', command: 'Meta', win: 'Meta',
};

function canonicaliseKey(token: string): string | null {
    if (!token) return null;
    // F-keys: F1..F24
    if (/^F\d+$/i.test(token)) return token.toUpperCase();
    // Single character: uppercase
    if (token.length === 1) return token.toUpperCase();
    // Named keys: title-case
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * Parse a binding string like "ctrl+shift+b" into the canonical form
 * "Ctrl+Shift+B". Returns null if the binding is malformed.
 */
export function parseBinding(raw: string): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Reject malformed forms like "+B" or "Ctrl+": the split would silently
    // collapse the empty segment otherwise.
    const rawParts = trimmed.split('+').map(p => p.trim());
    if (rawParts.some(p => p === '')) return null;
    const parts = rawParts.filter(Boolean);
    if (parts.length === 0) return null;

    const mods = new Set<string>();
    let key: string | null = null;

    for (const p of parts) {
        const low = p.toLowerCase();
        if (MODIFIER_ALIASES[low]) {
            mods.add(MODIFIER_ALIASES[low]);
        } else if (key !== null) {
            // Two non-modifier tokens — malformed.
            return null;
        } else {
            const k = canonicaliseKey(p);
            if (!k) return null;
            key = k;
        }
    }
    if (!key) return null;

    // Reject malformed segments like "+B" (which split to ['', 'B']) — those
    // were filtered by filter(Boolean) above, but we also disallow bindings
    // where the "key" is itself just a modifier name. canonicaliseKey would
    // have title-cased a modifier alias, so check explicitly.
    if (MODIFIER_ALIASES[key.toLowerCase()]) return null;

    const orderedMods = MODIFIER_ORDER.filter(m => mods.has(m));
    return [...orderedMods, key].join('+');
}

/**
 * Tests whether a KeyboardEvent matches a binding string.
 */
export function eventMatchesBinding(event: KeyboardEvent, binding: string): boolean {
    const parsed = parseBinding(binding);
    if (!parsed) return false;

    const parts = parsed.split('+');
    const key = parts[parts.length - 1];
    const mods = new Set(parts.slice(0, -1));

    // Coerce missing modifiers (e.g. test mocks) to false so the strict
    // mismatch check still works.
    if (!!event.ctrlKey  !== mods.has('Ctrl'))  return false;
    if (!!event.altKey   !== mods.has('Alt'))   return false;
    if (!!event.shiftKey !== mods.has('Shift')) return false;
    if (!!event.metaKey  !== mods.has('Meta'))  return false;

    const evKey = event.key ?? '';
    if (key.length === 1) {
        return evKey.toUpperCase() === key.toUpperCase();
    }
    // F-keys and named keys compare case-insensitively.
    return evKey.toLowerCase() === key.toLowerCase();
}

/**
 * Returns the active binding for a command id, taking user overrides
 * into account. `overrides[id] === null` explicitly unbinds the
 * command. Unknown command ids return null.
 */
export function resolveBindingForCommand(
    commandId: string,
    overrides: Record<string, string | null>,
): string | null {
    const cmd = COMMANDS.find(c => c.id === commandId);
    if (!cmd) return null;
    if (Object.prototype.hasOwnProperty.call(overrides, commandId)) {
        const v = overrides[commandId];
        if (v === null) return null;
        return parseBinding(v);
    }
    return cmd.defaultBinding;
}
