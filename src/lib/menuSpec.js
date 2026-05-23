/**
 * Single source of truth for the application menu. Consumed by BOTH:
 *   - the Electron native menu (src/electron/main.js, via require)
 *   - the web menu bar (src/components/journal/MenuBar.tsx, via import)
 * so the two are guaranteed identical.
 *
 * Order is the owner-specified layout:
 *   File · Edit · Search · View · Go · Insert · Format · Topic · Entry ·
 *   Category · User · Tools · Help
 *
 * CommonJS on purpose: main.js is plain Node (cannot import TS/ESM). Types are
 * in the sibling menuSpec.d.ts. Per-platform behaviour of each `action` is
 * resolved by src/lib/menuActions.ts (web) and main.js's handleMenuAction
 * (Electron), keeping this file pure data.
 */

const SEP = { separator: true };

const J8_MENUS = [
    {
        label: 'File',
        submenu: [
            { label: 'New Journal Volume…', action: 'new-journal-volume' },
            { label: 'Open Journal Volume…', action: 'open-journal-volume' },
            SEP,
            {
                label: 'Journal Volume Maintenance',
                submenu: [
                    { label: 'Backup Journal Volume…', action: 'backup-db' },
                    { label: 'Restore Journal Volume…', action: 'restore-db' },
                    { label: 'Check Integrity & Repair…', action: 'check-integrity' },
                    { label: 'Optimize / Defragment Database…', action: 'optimize-db' },
                ],
            },
            SEP,
            { label: 'Print Setup…', action: 'print-setup' },
            { label: 'Print Preview', action: 'print-preview' },
            { label: 'Print Entries…', action: 'print-entries', accel: 'CmdOrCtrl+P' },
            SEP,
            { label: 'Exit', action: 'exit', role: 'quit' },
        ],
    },
    {
        label: 'Edit',
        submenu: [
            { label: 'Undo', action: 'undo', role: 'undo', accel: 'CmdOrCtrl+Z' },
            { label: 'Redo', action: 'redo', role: 'redo', accel: 'CmdOrCtrl+Y' },
            SEP,
            { label: 'Cut', action: 'cut', role: 'cut', accel: 'CmdOrCtrl+X' },
            { label: 'Copy', action: 'copy', role: 'copy', accel: 'CmdOrCtrl+C' },
            { label: 'Paste', action: 'paste', role: 'paste', accel: 'CmdOrCtrl+V' },
            { label: 'Paste Special…', action: 'paste-special', accel: 'CmdOrCtrl+Shift+V' },
            SEP,
            { label: 'Select All', action: 'select-all', role: 'selectAll', accel: 'CmdOrCtrl+A' },
        ],
    },
    {
        label: 'Search',
        submenu: [
            { label: 'Find…', action: 'search', accel: 'CmdOrCtrl+F' },
            { label: 'Find Next', action: 'find-next', accel: 'F3' },
            { label: 'Replace…', action: 'replace', accel: 'CmdOrCtrl+H' },
            SEP,
            { label: 'Search Across All Categories…', action: 'search', accel: 'CmdOrCtrl+Shift+F' },
            { label: 'Global Find and Replace…', action: 'replace' },
        ],
    },
    {
        label: 'View',
        submenu: [
            {
                label: 'Toolbars',
                submenu: [
                    { label: 'Main Toolbar', action: 'toggle-main-toolbar' },
                    { label: 'Formatting Rich Text Toolbar', action: 'toggle-toolbar' },
                    { label: 'Status Bar', action: 'toggle-status-bar' },
                ],
            },
            {
                label: 'Sidebar Layout',
                submenu: [
                    { label: 'Left Side', action: 'sidebar-left' },
                    { label: 'Right Side', action: 'sidebar-right' },
                    { label: 'Hidden', action: 'sidebar-hidden' },
                ],
            },
            {
                label: 'Category Tabs Navigation',
                submenu: [
                    { label: 'Top Horizontal', action: 'tabs-top' },
                    { label: 'Bottom Horizontal', action: 'tabs-bottom' },
                    { label: 'Vertical Tree View', action: 'tabs-vertical' },
                ],
            },
            SEP,
            { label: 'Distraction-Free Mode', action: 'focus', accel: 'F11' },
            { label: 'Split Screen Layout', action: 'split', accel: 'CmdOrCtrl+\\' },
            { label: 'Refresh View', action: 'refresh', accel: 'F5' },
            SEP,
            { label: 'Toggle Theme', action: 'toggle-theme', accel: 'CmdOrCtrl+Shift+D' },
        ],
    },
    {
        label: 'Go',
        submenu: [
            { label: 'Today', action: 'go-today', accel: 'CmdOrCtrl+T' },
            { label: 'Go to Date…', action: 'go-to-date', accel: 'CmdOrCtrl+G' },
            SEP,
            { label: 'Previous Entry', action: 'nav-prev', accel: 'CmdOrCtrl+PageUp' },
            { label: 'Next Entry', action: 'nav-next', accel: 'CmdOrCtrl+PageDown' },
            SEP,
            { label: 'Back in History', action: 'history-back', accel: 'Alt+Left' },
            { label: 'Forward in History', action: 'history-forward', accel: 'Alt+Right' },
        ],
    },
    {
        label: 'Insert',
        submenu: [
            { label: 'File Attachment…', action: 'attachment' },
            { label: 'Image / Photo…', action: 'image-upload', accel: 'CmdOrCtrl+Shift+I' },
            { label: 'Hyperlink…', action: 'link', accel: 'CmdOrCtrl+K' },
            { label: 'Table…', action: 'insert-table' },
            { label: 'Horizontal Line', action: 'hr' },
            { label: 'Special Character / Symbol…', action: 'special-char' },
            { label: 'Bookmark…', action: 'bookmark' },
            { label: 'Checklist', action: 'checklist' },
            { label: 'Date & Time', action: 'datetime' },
            { label: 'Drawing…', action: 'insert-drawing' },
            { label: 'Insert from Template…', action: 'templates', accel: 'CmdOrCtrl+Shift+T' },
        ],
    },
    {
        label: 'Format',
        submenu: [
            { label: 'Font Properties…', action: 'font-properties' },
            { label: 'Paragraph Adjustments…', action: 'paragraph-properties' },
            {
                label: 'Styles',
                submenu: [
                    { label: 'Normal text', action: 'style-normal', accel: 'CmdOrCtrl+0' },
                    { label: 'Heading 1', action: 'style-h1', accel: 'CmdOrCtrl+1' },
                    { label: 'Heading 2', action: 'style-h2', accel: 'CmdOrCtrl+2' },
                    { label: 'Heading 3', action: 'style-h3', accel: 'CmdOrCtrl+3' },
                    { label: 'Block Quote', action: 'style-quote' },
                    { label: 'Code Block', action: 'style-code' },
                ],
            },
            { label: 'Bullets and Numbering…', action: 'bullets-numbering' },
            { label: 'Inline Code', action: 'inline-code', accel: 'CmdOrCtrl+E' },
            SEP,
            { label: 'Text Color', action: 'text-color' },
            { label: 'Highlight Background', action: 'highlight' },
        ],
    },
    {
        label: 'Topic',
        submenu: [
            { label: 'Assign Topics…', action: 'assign-topics' },
            { label: 'Manage Topics…', action: 'manage-topics' },
        ],
    },
    {
        label: 'Entry',
        submenu: [
            { label: 'New Entry', action: 'new-entry', accel: 'CmdOrCtrl+N' },
            { label: 'New Sub-Entry', action: 'new-subentry', accel: 'CmdOrCtrl+Shift+Return' },
            { label: 'Save Entry', action: 'save', accel: 'CmdOrCtrl+S' },
            { label: 'Delete Entry', action: 'delete-entry', accel: 'CmdOrCtrl+Delete' },
            SEP,
            { label: 'Entry Properties…', action: 'entry-properties' },
            { label: 'Lock / Unlock Entry', action: 'lock-entry' },
            { label: 'Move Entry to Category…', action: 'move-entry' },
            { label: 'Sort Sub-Entries', action: 'sort-subentries' },
        ],
    },
    {
        label: 'Category',
        submenu: [
            { label: 'New Category…', action: 'new-category', accel: 'CmdOrCtrl+Shift+N' },
            { label: 'Category Properties…', action: 'category-properties', accel: 'CmdOrCtrl+Shift+P' },
            { label: 'Delete Category…', action: 'delete-category' },
            SEP,
            { label: 'Import Entries…', action: 'import-entries' },
            { label: 'Export Entries…', action: 'export-entries' },
            { label: 'Sync Category…', action: 'sync-category' },
            SEP,
            { label: 'View Category as Calendar', action: 'category-calendar' },
            { label: 'View Category as Loose-leaf', action: 'category-looseleaf' },
        ],
    },
    {
        label: 'User',
        submenu: [
            { label: 'Log In as Different User…', action: 'switch-user' },
            { label: 'Manage Users…', action: 'manage-users' },
            { label: 'Change Password…', action: 'change-password' },
            { label: 'Set up Automatic Login…', action: 'auto-login' },
        ],
    },
    {
        label: 'Tools',
        submenu: [
            { label: 'Reminders & Tasks Manager', action: 'reminders' },
            { label: 'Word Cloud', action: 'wordcloud' },
            { label: 'Text Statistics', action: 'stats' },
            { label: 'Writing Prompts Generator', action: 'prompts' },
            { label: 'Memory Inclusions / On This Day…', action: 'on-this-day' },
            { label: 'Word Goals…', action: 'goals' },
            { label: 'Snippets…', action: 'snippets' },
            SEP,
            { label: 'Trash…', action: 'trash' },
            SEP,
            { label: 'Options / Preferences…', action: 'settings' },
        ],
    },
    {
        label: 'Plugins',
        submenu: [
            // First-party plugins are bundled and always available; invoking an
            // item runs the plugin's registered editor action.
            { label: 'Insert Draw.io Diagram', action: 'run-plugin-drawio' },
            { label: 'Insert Sentence Diagram', action: 'run-plugin-sentence-diagrammer' },
            SEP,
            { label: 'Install Plugin…', action: 'install-plugin' },
            { label: 'Manage Plugins…', action: 'settings' },
            { label: 'Open Plugins Folder', action: 'open-plugins-folder' },
        ],
    },
    {
        label: 'Help',
        submenu: [
            { label: 'Documentation', action: 'help-docs' },
            { label: 'Keyboard Shortcuts', action: 'help-shortcuts' },
            { label: 'Plugin API Reference', action: 'help-plugin-api' },
            SEP,
            { label: 'Check for Updates…', action: 'check-updates' },
            { label: 'Report an Issue', action: 'report-issue' },
            { label: 'About TheJournal', action: 'about' },
        ],
    },
];

module.exports = { J8_MENUS };
