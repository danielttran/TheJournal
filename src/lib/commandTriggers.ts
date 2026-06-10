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
 * EVERY command id maps here (command-triggers.test.ts enforces it). Earlier
 * a "handled elsewhere" carve-out (TipTap keymap, hardcoded editor keydown,
 * LockGate's own hotkey) covered the DEFAULT keys but made REBINDING those
 * commands a silent no-op — the rebound key dispatched a `tj-command` event
 * nobody listened for.
 */
export const COMMAND_TRIGGER_MAP: Record<string, string> = {
    'edit.undo': 'trigger-undo',
    'edit.redo': 'trigger-redo',
    'edit.find': 'trigger-find-in-entry',
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
    // Marks: TipTap's keymap handles the default keys inside the editor (and
    // preventDefaults, so the dispatcher bails); these mappings make REBOUND
    // keys work too.
    'format.bold': 'trigger-bold',
    'format.italic': 'trigger-italic',
    'format.underline': 'trigger-underline',
    'format.strikethrough': 'trigger-strikethrough',
    'format.clear': 'trigger-clear-format',
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
    'insert.image-url': 'trigger-image-url',
    'insert.drawing': 'trigger-insert-drawing',
    'insert.checklist': 'trigger-checklist',
    'insert.hr': 'trigger-hr',
    'insert.template': 'trigger-templates',
    'insert.prompt': 'trigger-prompts',
    'view.search': 'trigger-search',
    'view.search-all': 'trigger-search-all',
    'view.toggle-theme': 'trigger-toggle-theme',
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
    'nav.prev-category': 'trigger-prev-category',
    'nav.next-category': 'trigger-next-category',
    'entry.save': 'trigger-save',
    'entry.properties': 'trigger-entry-properties',
    'entry.new-subentry': 'trigger-new-subentry',
    'entry.print': 'trigger-print-entry',
    'category.properties': 'trigger-category-properties',
    'security.lock': 'trigger-lock-app',
};
