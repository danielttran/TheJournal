import type { MenuLeaf } from './menuSpec';

/**
 * Resolves what a menu item does on the WEB target. Pure + DOM-free so every
 * menu item's behaviour can be unit-tested (no item silently does nothing).
 * MenuBar.tsx executes the result; Electron routes the same `action`s through
 * main.js's handleMenuAction.
 */

export type MenuActionResult =
    | { kind: 'role'; role: string }        // clipboard/undo — execCommand
    | { kind: 'event'; event: string }      // window.dispatchEvent(new Event(event))
    | { kind: 'plugin'; id: string }        // run a registered plugin by id (trigger-run-plugin)
    | { kind: 'open'; url: string }         // window.open(url, '_blank')
    | { kind: 'info'; message: string }     // alert (genuinely desktop-only / informational)
    | { kind: 'close' };                    // window.close()

/**
 * Every `trigger-*` event that some component actually listens for. The
 * menu-actions test asserts every resolved `event` is in this set, so a menu
 * item can never resolve to an event nobody handles.
 *
 * Keep in sync with the addEventListener('trigger-…') / loop-registered
 * handlers in: Editor, Sidebar, JournalView, TabBar, GlobalIPCManager,
 * EntryPrintBridge, TipTapToolbar.
 */
export const HANDLED_WEB_EVENTS = new Set<string>([
    // Editor + toolbar (formatting / insert / per-entry)
    'trigger-save', 'trigger-entry-properties', 'trigger-toggle-toolbar', 'trigger-toggle-status-bar',
    'trigger-insert-table', 'trigger-style-normal', 'trigger-style-h1', 'trigger-style-h2', 'trigger-style-h3',
    'trigger-style-quote', 'trigger-style-code', 'trigger-bullets-numbering', 'trigger-text-color',
    'trigger-font-properties', 'trigger-paragraph-properties', 'trigger-lock-entry',
    'trigger-link', 'trigger-paste-special', 'trigger-bookmark', 'trigger-datetime', 'trigger-special-char',
    'trigger-attachment', 'trigger-highlight', 'trigger-inline-code', 'trigger-checklist', 'trigger-hr',
    'trigger-image-upload', 'trigger-undo', 'trigger-redo', 'trigger-search', 'trigger-focus', 'trigger-split',
    'trigger-split-orientation',
    'trigger-prompts', 'trigger-templates', 'trigger-run-plugin', 'trigger-insert-drawing',
    // Sidebar (entry tree)
    'trigger-nav-prev', 'trigger-nav-next', 'trigger-new-subentry', 'trigger-new-entry',
    'trigger-delete-entry', 'trigger-sort-subentries', 'trigger-assign-topics', 'trigger-move-entry',
    'trigger-tag-selection',
    // JournalView (navigation / layout / category view-mode)
    'trigger-go-today', 'trigger-go-to-date', 'trigger-history-back', 'trigger-history-forward',
    'trigger-find-next', 'trigger-find-in-entry', 'trigger-toggle-sidebar', 'trigger-sidebar-side', 'trigger-sidebar-left',
    'trigger-sidebar-right', 'trigger-sidebar-hidden', 'trigger-refresh', 'trigger-category-calendar',
    'trigger-category-looseleaf',
    // TabBar (panels / categories / tabs)
    'trigger-replace', 'trigger-reminders', 'trigger-wordcloud', 'trigger-on-this-day',
    'trigger-new-category', 'trigger-category-properties', 'trigger-delete-category',
    'trigger-import-entries', 'trigger-export-entries', 'trigger-sync-category',
    'trigger-toggle-main-toolbar', 'trigger-tabs-top', 'trigger-tabs-bottom', 'trigger-tabs-vertical',
    'trigger-trash', 'trigger-goals', 'trigger-stats', 'trigger-snippets',
    // GlobalIPCManager (db / users / topics / settings / account / volumes)
    'trigger-settings', 'trigger-check-integrity', 'trigger-optimize-db', 'trigger-change-password',
    'trigger-switch-user', 'trigger-manage-users', 'trigger-manage-topics', 'trigger-auto-login',
    'trigger-restore-db', 'trigger-logout', 'trigger-check-updates', 'trigger-journal-volumes',
    'trigger-toggle-theme',
    // EntryPrintBridge
    'trigger-print-entry', 'trigger-print-preview', 'trigger-export-pdf',
]);

const WEB_URL: Record<string, string> = {
    'help-docs': 'https://github.com/danielttran/TheJournal#readme',
    'help-plugin-api': 'https://github.com/danielttran/TheJournal/blob/main/docs/plugins.md',
    'report-issue': 'https://github.com/danielttran/TheJournal/issues/new',
    'backup-db': '/api/backup/export',
};

// Web event that differs from the default `trigger-<action>`. Every functional
// menu item maps to a REAL action on web (no dead "desktop only" dialogs):
const WEB_EVENT: Record<string, string> = {
    'print-entries': 'trigger-print-entry',
    'print-setup': 'trigger-print-entry',
    // Print Preview opens an in-app preview modal (distinct from firing the OS
    // print dialog directly); the modal has its own Print button.
    'print-preview': 'trigger-print-preview',
    'help-shortcuts': 'trigger-settings',
    // Web plugin management lives in Settings → Plugins (PluginsSection).
    'install-plugin': 'trigger-settings',
    'open-plugins-folder': 'trigger-settings',
    // Exit on web ends the session (logout) rather than killing a process.
    'exit': 'trigger-logout',
    // Volumes: a real Volume Manager modal (lists server volumes). Switching the
    // active DB on a shared web server is a deployment concern, surfaced there.
    'new-journal-volume': 'trigger-journal-volumes',
    'open-journal-volume': 'trigger-journal-volumes',
    // auto-login / check-updates have real web handlers (Settings / version check).
};

// Only true informational items remain (About is informational on every platform).
const WEB_INFO: Record<string, string> = {
    'about': 'TheJournal — a local-first encrypted journaling app with DavidRM "The Journal 8"-style menus.',
};

export function resolveWebMenuAction(node: MenuLeaf): MenuActionResult {
    if (node.role) return { kind: 'role', role: node.role };
    const a = node.action ?? '';
    if (a.startsWith('run-plugin-')) return { kind: 'plugin', id: a.slice('run-plugin-'.length) };
    if (WEB_URL[a]) return { kind: 'open', url: WEB_URL[a] };
    if (WEB_INFO[a] !== undefined) return { kind: 'info', message: WEB_INFO[a] };
    if (WEB_EVENT[a]) return { kind: 'event', event: WEB_EVENT[a] };
    return { kind: 'event', event: `trigger-${a}` };
}
