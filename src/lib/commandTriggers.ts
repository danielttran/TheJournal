/**
 * Maps command-registry ids (src/lib/commands.ts) to the DOM `trigger-*` events
 * the editor / shell already listen for. The runtime dispatcher
 * (CommandDispatcher.tsx) looks a command up here and dispatches the mapped
 * event when its keybinding fires.
 *
 * Pure data so vitest can guard it without a DOM — in particular so a command
 * that has an editor handler can't silently lose its keybinding wiring again
 * (the style.* shortcuts regression).
 *
 * Not every command lives here: format.bold/italic/underline/strikethrough are
 * handled by TipTap's StarterKit keymap, edit.find is handled directly by the
 * editor's own keydown, security.lock by LockGate, and menu-only actions have
 * no keybinding. Commands absent from this map fall through to a generic
 * `tj-command` CustomEvent.
 */
export const COMMAND_TRIGGER_MAP: Record<string, string> = {
    'edit.undo': 'trigger-undo',
    'edit.redo': 'trigger-redo',
    'edit.find-next': 'trigger-find-next',
    'edit.replace': 'trigger-replace',
    'edit.paste-special': 'trigger-paste-special',
    'insert.link': 'trigger-link',
    'insert.bookmark': 'trigger-bookmark',
    'insert.datetime': 'trigger-datetime',
    'insert.special-char': 'trigger-special-char',
    'insert.attachment': 'trigger-attachment',
    'format.highlight': 'trigger-highlight',
    'format.code': 'trigger-inline-code',
    // Paragraph-style shortcuts (Ctrl+1/2/3/0/9, Ctrl+Shift+C). The editor
    // already listens for these trigger-style-* events from the Format menu;
    // without these entries the keybindings dispatched into a dead tj-command.
    'style.heading-1': 'trigger-style-h1',
    'style.heading-2': 'trigger-style-h2',
    'style.heading-3': 'trigger-style-h3',
    'style.paragraph': 'trigger-style-normal',
    'style.blockquote': 'trigger-style-quote',
    'style.code-block': 'trigger-style-code',
    'insert.image-upload': 'trigger-image-upload',
    'insert.drawing': 'trigger-insert-drawing',
    'insert.checklist': 'trigger-checklist',
    'insert.hr': 'trigger-hr',
    'insert.template': 'trigger-templates',
    'insert.prompt': 'trigger-prompts',
    'view.search': 'trigger-search',
    'view.focus-mode': 'trigger-focus',
    'view.split': 'trigger-split',
    'view.toggle-sidebar': 'trigger-toggle-sidebar',
    'view.sidebar-side': 'trigger-sidebar-side',
    'view.toggle-toolbar': 'trigger-toggle-toolbar',
    'nav.today': 'trigger-go-today',
    'nav.go-to-date': 'trigger-go-to-date',
    'nav.prev-entry': 'trigger-nav-prev',
    'nav.next-entry': 'trigger-nav-next',
    'nav.back': 'trigger-history-back',
    'nav.forward': 'trigger-history-forward',
    'entry.save': 'trigger-save',
    'entry.properties': 'trigger-entry-properties',
    'entry.new-subentry': 'trigger-new-subentry',
};
