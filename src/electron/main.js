const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const getPort = require('get-port');
const SettingsManager = require('./settings');
const { clampWindowBounds } = require('../lib/windowState');
const { applyMenuCustomization } = require('../lib/menuCustomization');

const dev = process.env.NODE_ENV !== 'production';
const dir = path.join(__dirname, '../../'); // Adjust based on where main.js is (src/electron/main.js -> root is ../../)

// settingsManager is initialized inside app.whenReady() because SettingsManager's
// constructor calls app.getPath('userData'), which requires the app to be ready.
let settingsManager;
// Track scheduled background backup so we can stop it cleanly at shutdown.
let backupIntervalHandle = null;

function getDatabasePath() {
    const currentSettings = settingsManager.getSettings();
    if (currentSettings.dbPath && currentSettings.dbPath !== 'default') {
        return currentSettings.dbPath;
    }
    return dev
        ? path.join(dir, 'journal.tjdb')
        : path.join(app.getPath('userData'), 'journal.tjdb');
}

// Switch the active journal volume: persist the new path and relaunch so the
// embedded Next server (and its DBManager) re-open against it. Used by both
// "New Journal Volume" and "Open Another Journal".
function switchJournalVolume(filePath) {
    settingsManager.saveSettings({ dbPath: filePath });
    app.relaunch();
    app.exit(0);
}

// ─── Backup Logic ─────────────────────────────────────────────────────────────
// Extracted from before-quit so it can also be called on a recurring schedule.
// Safe to call concurrently — if the DB file doesn't exist it fails gracefully.
async function performAutoBackup() {
    const fs = require('fs');
    const s = settingsManager.getSettings();

    console.log('[Electron] performAutoBackup: checking settings...');
    if (!s.autoBackupOnClose || !s.backupPath) {
        console.log('[Electron] performAutoBackup: disabled or no path set, skipping.');
        return;
    }

    // Honor "Backup Frequency (Days)": skip if the last auto-backup was more
    // recent than the configured interval. A value < 1 means "every close".
    const freqDays = Number(s.backupFrequency);
    if (Number.isFinite(freqDays) && freqDays >= 1 && s.lastAutoBackup) {
        const last = Date.parse(s.lastAutoBackup);
        if (Number.isFinite(last)) {
            const elapsedDays = (Date.now() - last) / 86_400_000;
            if (elapsedDays < freqDays) {
                console.log(`[Electron] performAutoBackup: last backup ${elapsedDays.toFixed(1)}d ago < ${freqDays}d interval, skipping.`);
                return;
            }
        }
    }

    const dbPath = process.env.JOURNAL_DB_PATH || getDatabasePath();
    console.log('[Electron] performAutoBackup: source DB =', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.error('[Electron] ❌ performAutoBackup: source DB not found at:', dbPath);
        return;
    }

    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup-${timestamp}.tjdb`;

        // DATA RETENTION LOGIC
        const maxBackups = s.retentionCount > 0 ? s.retentionCount : 3;

        if (!fs.existsSync(s.backupPath)) {
            fs.mkdirSync(s.backupPath, { recursive: true });
        }

        // Collect all existing .tjdb backups and prune oldest if over limit
        const files = fs.readdirSync(s.backupPath);
        const tjdbFiles = [];
        for (const file of files) {
            if (file.endsWith('.tjdb')) {
                const fullPath = path.join(s.backupPath, file);
                const stat = fs.statSync(fullPath);
                tjdbFiles.push({ name: file, path: fullPath, ctimeMs: stat.ctimeMs });
            }
        }
        tjdbFiles.sort((a, b) => a.ctimeMs - b.ctimeMs);

        while (tjdbFiles.length > (maxBackups - 1) && tjdbFiles.length > 0) {
            const oldest = tjdbFiles.shift();
            try {
                fs.unlinkSync(oldest.path);
                console.log(`[Electron] Deleted old backup: ${oldest.name}`);
            } catch (e) {
                console.error(`[Electron] Failed to delete old backup ${oldest.name}:`, e);
            }
        }

        const dest = path.join(s.backupPath, backupName);
        fs.copyFileSync(dbPath, dest);

        // Copy WAL and SHM sidecars to ensure consistency
        ['wal', 'shm'].forEach(suffix => {
            const sidecar = `${dbPath}-${suffix}`;
            if (fs.existsSync(sidecar)) {
                fs.copyFileSync(sidecar, `${dest}-${suffix}`);
            }
        });

        // Record when so the frequency gate above can throttle the next close.
        settingsManager.saveSettings({ lastAutoBackup: new Date().toISOString() });

        console.log('[Electron] ✅ Auto-backup SUCCESS at:', dest);
    } catch (err) {
        console.error('[Electron] ❌ Auto-backup FAILED:', err);
    }
}

async function startServer() {
    // Mark the embedded Next.js process as desktop-hosted. Server routes use
    // this to enable Electron-only shortcuts (e.g. importing a database by an
    // OS filesystem path) that would be a cross-tenant vector on multi-user web.
    process.env.JOURNAL_DESKTOP = '1';

    // Set DB Path for Next.js and the renderer to use
    process.env.JOURNAL_DB_PATH = getDatabasePath();
    console.log('[Electron] Database Path:', process.env.JOURNAL_DB_PATH);

    // Steer the web-build plugins API at the Electron plugin folder so the
    // Settings → Plugins UI and the native Plugins → Install Plugin menu
    // both touch the same on-disk location. Without this, installs done
    // via the in-app UI would land in <cwd>/plugins while installs done
    // via the menu land in [userData]/plugins.
    process.env.JOURNAL_PLUGINS_DIR = path.join(app.getPath('userData'), 'plugins');
    console.log('[Electron] Plugins Path:', process.env.JOURNAL_PLUGINS_DIR);

    // Copy bundled plugins (drawio, sentence-diagrammer) into the user
    // plugin folder on first launch so they show up in the toolbar
    // immediately. No-op on subsequent runs.
    seedBundledPluginsIfEmpty();

    const port = await getPort({ port: getPort.makeRange(3000, 3100) });

    if (dev) {
        return { url: 'http://localhost:3000', port: 3000 };
    }

    // In production, we use Next.js programmatically
    // This requires 'next' to be in dependencies (not devDeps)
    const nextApp = next({ dev, dir });
    const handle = nextApp.getRequestHandler();

    await nextApp.prepare();

    const server = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
    });

    return new Promise((resolve, reject) => {
        server.listen(port, (err) => {
            if (err) return reject(err);
            console.log(`> Ready on http://localhost:${port}`);
            resolve({ url: `http://localhost:${port}`, port, server });
        });
    });
}

let mainWindow;
let serverInstance;
let tray = null;
// Set true when the user picks Quit from the tray/menu so the window 'close'
// handler knows to actually exit instead of hiding to the tray.
let isQuitting = false;

function getPluginDir() {
    return path.join(app.getPath('userData'), 'plugins');
}

function ensurePluginDir() {
    const pluginDir = getPluginDir();
    fs.mkdirSync(pluginDir, { recursive: true });
    return pluginDir;
}

/**
 * First-run seed: if [userData]/plugins/ is empty (or missing), copy the
 * bundled plugins from the app's repo-relative plugins/ folder. Without
 * this the bundled drawio + sentence-diagrammer plugins are invisible to
 * Electron users on first launch because the plugin loader scans
 * [userData]/plugins/, not the asar-bundled repo folder.
 *
 * Subsequent launches see the seeded plugins on disk and skip the copy.
 * Users who delete a bundled plugin keep it deleted — we only seed when
 * the directory has NO entries at all.
 */
function seedBundledPluginsIfEmpty() {
    const pluginDir = ensurePluginDir();
    let existing = [];
    try { existing = fs.readdirSync(pluginDir); } catch { existing = []; }
    if (existing.length > 0) return;

    // Bundled plugins live in the asar (or app dir in dev) under `plugins/`.
    // Resolve from this file's location: src/electron/main.js → ../../plugins/
    const bundledRoot = path.join(__dirname, '..', '..', 'plugins');
    if (!fs.existsSync(bundledRoot)) return;

    try {
        fs.cpSync(bundledRoot, pluginDir, { recursive: true });
        console.log('[Electron] Seeded bundled plugins into', pluginDir);
    } catch (err) {
        console.error('[Electron] Failed to seed bundled plugins:', err);
    }
}

function readInstalledPlugins() {
    const pluginDir = ensurePluginDir();
    const plugins = [];
    const entries = fs.readdirSync(pluginDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const manifestPath = path.join(pluginDir, entry.name, 'manifest.json');
        const scriptPath = path.join(pluginDir, entry.name, 'main.js');

        if (!fs.existsSync(manifestPath) || !fs.existsSync(scriptPath)) continue;

        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const scriptContent = fs.readFileSync(scriptPath, 'utf8');

            plugins.push({
                id: entry.name,
                manifest,
                scriptContent,
            });
        } catch (err) {
            console.error(`[Electron] Failed to load plugin "${entry.name}":`, err);
        }
    }

    return plugins;
}

async function installPluginFromFolder(sourcePath, dialog) {
    if (!sourcePath) return false;

    const resolvedSourcePath = path.resolve(sourcePath);

    const manifestPath = path.join(resolvedSourcePath, 'manifest.json');
    const scriptPath = path.join(resolvedSourcePath, 'main.js');

    if (!fs.existsSync(manifestPath) || !fs.existsSync(scriptPath)) {
        await dialog.showMessageBox(mainWindow ?? undefined, {
            type: 'error',
            title: 'Invalid Plugin',
            message: 'That folder is not a valid plugin.',
            detail: 'A plugin folder must contain both manifest.json and main.js.',
        });
        return false;
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
        await dialog.showMessageBox(mainWindow ?? undefined, {
            type: 'error',
            title: 'Invalid Plugin Manifest',
            message: 'The plugin manifest could not be parsed.',
            detail: err && err.message ? err.message : String(err),
        });
        return false;
    }

    const rawId = String(manifest.id || path.basename(resolvedSourcePath));
    const sanitizedId = rawId.replace(/[^A-Za-z0-9._-]/g, '-');
    // Reject ids that would escape the plugins directory or refer to the
    // directory itself. Without this, a manifest with `"id": ".."` would
    // resolve destinationPath to the userData root and the rmSync below
    // would wipe the user's database, settings, and other plugins.
    const looksLikeTraversal = !sanitizedId
        || sanitizedId === '.'
        || sanitizedId === '..'
        || sanitizedId.startsWith('.')
        || sanitizedId.includes('/')
        || sanitizedId.includes('\\');
    if (looksLikeTraversal) {
        await dialog.showMessageBox(mainWindow ?? undefined, {
            type: 'error',
            title: 'Invalid Plugin ID',
            message: 'The plugin id is not allowed.',
            detail: 'Plugin ids must consist of letters, numbers, underscores, or hyphens, and cannot be ".", "..", or start with a dot.',
        });
        return false;
    }
    const pluginId = sanitizedId;
    const pluginsDir = ensurePluginDir();
    const destinationPath = path.resolve(pluginsDir, pluginId);
    // Defense in depth: ensure destinationPath is strictly inside pluginsDir.
    const relFromPluginsDir = path.relative(pluginsDir, destinationPath);
    if (
        !relFromPluginsDir
        || relFromPluginsDir.startsWith('..')
        || path.isAbsolute(relFromPluginsDir)
        || relFromPluginsDir.split(path.sep).length !== 1
    ) {
        await dialog.showMessageBox(mainWindow ?? undefined, {
            type: 'error',
            title: 'Invalid Plugin Path',
            message: 'The plugin destination is outside the plugins folder.',
            detail: 'This plugin id would write outside the managed plugins directory and was refused.',
        });
        return false;
    }
    const isAlreadyInstalled = resolvedSourcePath.toLowerCase() === destinationPath.toLowerCase();

    if (!isAlreadyInstalled && fs.existsSync(destinationPath)) {
        const overwrite = await dialog.showMessageBox(mainWindow ?? undefined, {
            type: 'question',
            buttons: ['Replace', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            title: 'Replace Plugin?',
            message: `A plugin named "${pluginId}" is already installed.`,
            detail: 'Replacing it will overwrite the existing plugin files.',
        });

        if (overwrite.response !== 0) return false;
    }

    try {
        if (!isAlreadyInstalled) {
            fs.rmSync(destinationPath, { recursive: true, force: true });
            fs.cpSync(resolvedSourcePath, destinationPath, { recursive: true, force: true });
        }

        const reload = await dialog.showMessageBox(mainWindow ?? undefined, {
            type: 'info',
            buttons: ['Reload Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
            title: isAlreadyInstalled ? 'Plugin Ready' : 'Plugin Installed',
            message: `"${manifest.name || pluginId}" ${isAlreadyInstalled ? 'is already in the plugins folder.' : 'has been installed.'}`,
            detail: 'Reload the app to make newly installed plugins available to the editor.',
        });

        if (reload.response === 0 && mainWindow) {
            mainWindow.webContents.reload();
        }

        return true;
    } catch (err) {
        console.error(`[Electron] Failed to install plugin "${pluginId}":`, err);
        await dialog.showMessageBox(mainWindow ?? undefined, {
            type: 'error',
            title: 'Plugin Install Failed',
            message: 'The plugin could not be installed.',
            detail: err && err.message ? err.message : String(err),
        });
        return false;
    }
}

// Persist the live window geometry so the next launch restores it (J8 parity).
// Debounced because resize/move fire in bursts while dragging.
let saveBoundsTimer = null;
function persistWindowState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        const maximized = mainWindow.isMaximized();
        const patch = { windowMaximized: maximized };
        // Only record normal bounds when not maximized/minimized; otherwise we'd
        // save the full-screen rect and lose the user's restored size.
        if (!maximized && !mainWindow.isMinimized()) {
            patch.windowBounds = mainWindow.getNormalBounds
                ? mainWindow.getNormalBounds()
                : mainWindow.getBounds();
        }
        settingsManager.saveSettings(patch);
    } catch (err) {
        console.error('[Electron] persistWindowState failed:', err);
    }
}
function scheduleSaveBounds() {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(persistWindowState, 400);
}

function createWindow(url) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    const opts = {
        width: Math.floor(width * 0.9),
        height: Math.floor(height * 0.9),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: false,
        backgroundColor: '#111827', // Match bg-bg-app
    };

    // Restore saved geometry, clamped back onto a visible screen so a window
    // saved on a now-disconnected monitor can't open out of reach.
    const s = settingsManager?.getSettings?.() ?? {};
    const areas = screen.getAllDisplays().map(d => d.workArea);
    const restored = clampWindowBounds(s.windowBounds, areas);
    if (restored) {
        opts.x = restored.x; opts.y = restored.y;
        opts.width = restored.width; opts.height = restored.height;
    }

    mainWindow = new BrowserWindow(opts);
    if (s.windowMaximized) mainWindow.maximize();

    mainWindow.loadURL(url);

    mainWindow.on('resize', scheduleSaveBounds);
    mainWindow.on('move', scheduleSaveBounds);
    mainWindow.on('maximize', persistWindowState);
    mainWindow.on('unmaximize', persistWindowState);

    // Minimize-to-tray: when enabled, closing the window hides it to the tray
    // and keeps the app running instead of quitting. Quit via the tray menu
    // (which sets isQuitting) bypasses this.
    mainWindow.on('close', (e) => {
        const cur = settingsManager?.getSettings?.() ?? {};
        if (cur.minimizeToTray && !isQuitting) {
            e.preventDefault();
            persistWindowState();
            mainWindow.hide();
            return;
        }
        persistWindowState();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // M3: lock on minimize. When enabled in settings, hint the renderer
    // to drop session state and route back to /login. The renderer also
    // listens for its own idle timer; this main-process hook covers the
    // case where the OS minimizes the window before the renderer notices.
    mainWindow.on('minimize', () => {
        try {
            const cur = settingsManager?.getSettings?.() ?? {};
            if (cur.lockOnMinimize && mainWindow) {
                mainWindow.webContents.send('lock-app', { reason: 'minimize' });
            }
        } catch (err) {
            console.error('[Electron] lock-on-minimize hook failed:', err);
        }
    });
}

// System tray (J8 parity). Built lazily and guarded: a missing icon or an
// unsupported platform must never crash startup — tray just stays absent.
function ensureTray(url) {
    if (tray) return;
    try {
        const iconPath = path.join(__dirname, '..', '..', 'public', 'favicon.ico');
        const image = nativeImage.createFromPath(iconPath);
        if (image.isEmpty()) return; // no usable icon — skip tray silently
        tray = new Tray(image);
        tray.setToolTip('TheJournal');
        const showWindow = () => {
            if (!mainWindow) { createWindow(url); return; }
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        };
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: 'Open TheJournal', click: showWindow },
            { type: 'separator' },
            { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
        ]));
        tray.on('click', showWindow);
    } catch (err) {
        console.error('[Electron] tray init failed (continuing without tray):', err);
    }
}

function createMenu() {
    const { dialog, shell } = require("electron");
    const { J8_MENUS } = require("../lib/menuSpec");

    const sendViewAction = (action) => {
        console.log('[TJ action] electron menu → renderer:', action);
        if (mainWindow) mainWindow.webContents.send("view-action", action);
    };

    // Native (main-process) menu actions that cannot be a renderer view-action
    // (filesystem dialogs, relaunch, plugins, updates, external links).
    const handleMenuAction = async (action) => {
        console.log('[TJ action] electron menu (native):', action);
        switch (action) {
            case "new-journal-volume": {
                if (!mainWindow) return;
                const r = await dialog.showSaveDialog(mainWindow, { title: "New Journal Volume", defaultPath: "journal.tjdb", filters: [{ name: "TheJournal database", extensions: ["tjdb"] }] });
                if (r.canceled || !r.filePath) return;
                let t = r.filePath; if (!t.toLowerCase().endsWith(".tjdb")) t += ".tjdb";
                switchJournalVolume(t);
                return;
            }
            case "open-journal-volume": {
                if (!mainWindow) return;
                const r = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "TheJournal database", extensions: ["tjdb"] }], title: "Open Journal" });
                if (!r.canceled && r.filePaths.length > 0) switchJournalVolume(r.filePaths[0]);
                return;
            }
            case "backup-db":
                if (mainWindow) mainWindow.webContents.send("export-db");
                return;
            case "restore-db": {
                if (!mainWindow) return;
                const r = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "Database", extensions: ["db", "sqlite", "tjdb"] }] });
                if (!r.canceled && r.filePaths.length > 0) mainWindow.webContents.send("import-db", r.filePaths[0]);
                return;
            }
            case "print-entries":
            case "print-setup":
                if (mainWindow) mainWindow.webContents.send("print-current-entry");
                return;
            case "print-preview":
                // Opens the in-app preview modal (renderer handles trigger-print-preview).
                sendViewAction(action);
                return;
            case "install-plugin": {
                if (!mainWindow) return;
                const r = await dialog.showOpenDialog(mainWindow, { title: "Install Plugin", properties: ["openDirectory"] });
                if (!r.canceled && r.filePaths.length > 0) await installPluginFromFolder(r.filePaths[0], dialog);
                return;
            }
            case "open-plugins-folder":
                try { await shell.openPath(ensurePluginDir()); } catch (e) { console.error("[Electron] open plugins folder:", e); }
                return;
            case "help-docs":
                try { await shell.openExternal("https://github.com/danielttran/TheJournal#readme"); } catch (e) { console.error(e); }
                return;
            case "help-plugin-api":
                try { await shell.openExternal("https://github.com/danielttran/TheJournal/blob/main/docs/plugins.md"); } catch (e) { console.error(e); }
                return;
            case "report-issue":
                try { await shell.openExternal("https://github.com/danielttran/TheJournal/issues/new"); } catch (e) { console.error(e); }
                return;
            // help-shortcuts falls through to the renderer (default → view-action),
            // which opens Settings scrolled to the Keyboard Shortcuts section via
            // SETTINGS_SECTION_FOR_ACTION — same deep-link as the web menu.
            case "check-updates": {
                const { dialog: upDialog } = require("electron");
                try {
                    const result = await autoUpdater.checkForUpdates();
                    if (!result || !result.updateInfo || result.updateInfo.version === app.getVersion()) {
                        await upDialog.showMessageBox(mainWindow ?? undefined, { type: "info", title: "No updates", message: "You are on the latest version (" + app.getVersion() + ").", buttons: ["OK"] });
                    }
                } catch (err) {
                    await upDialog.showMessageBox(mainWindow ?? undefined, { type: "warning", title: "Update check failed", message: "Could not check for updates.", detail: err && err.message ? err.message : String(err), buttons: ["OK"] });
                }
                return;
            }
            case "about": {
                const { dialog: aboutDialog, app: aboutApp } = require("electron");
                aboutDialog.showMessageBox(mainWindow ?? undefined, { type: "info", title: "About TheJournal", message: "TheJournal", detail: "Version " + aboutApp.getVersion() + String.fromCharCode(10,10) + "A local-first encrypted journaling app with DavidRM The Journal 8 parity.", buttons: ["OK"] });
                return;
            }
            default:
                sendViewAction(action);
        }
    };

    const toTemplate = (nodes) => nodes.map((n) => {
        if (n.separator) return { type: "separator" };
        const item = { label: n.label };
        if (n.accel) item.accelerator = n.accel;
        if (n.submenu) { item.submenu = toTemplate(n.submenu); return item; }
        if (n.role) { item.role = n.role; return item; }
        item.click = () => handleMenuAction(n.action);
        return item;
    });

    // Apply the user's menu customization (hidden items) so the native menu
    // matches the web MenuBar, both built from the same shared spec.
    const hidden = (settingsManager?.getSettings?.() ?? {}).menuHiddenItems || [];
    const effectiveMenus = applyMenuCustomization(J8_MENUS, hidden);

    const template = effectiveMenus.map((m) => ({ label: m.label, submenu: toTemplate(m.submenu) }));
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}


// Single-instance lock: a second launch would start another embedded Next.js
// server opening the SAME journal.tjdb with a second SQLCipher writer connection,
// inviting WAL contention / SQLITE_BUSY. Refuse the second instance and instead
// surface the already-running window. Calling app.quit() before 'ready' prevents
// whenReady() below from firing.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
        }
    });
}

app.whenReady().then(async () => {
    try {
        // Initialize settings FIRST — requires app to be ready for getPath('userData')
        settingsManager = new SettingsManager();

        createMenu();

        // Register IPC Handlers
        ipcMain.handle('get-settings', () => settingsManager.getSettings());
        // Keys the renderer is allowed to write through the generic setter.
        // `dbPath` is deliberately excluded: it is set ONLY via the native
        // file picker (select-database). Without this guard a compromised
        // renderer (e.g. XSS via pasted/plugin content) could repoint the
        // app at an attacker-controlled database that opens on next launch.
        const RENDERER_WRITABLE_SETTINGS = new Set([
            'theme', 'userName', 'rememberMe', 'savedPassword',
            'backupPath', 'autoBackupOnClose', 'backupFrequency', 'retentionCount',
            'defaultFontSize', 'idleLockMinutes', 'lockOnMinimize', 'themePreferences',
            'minimizeToTray', 'menuHiddenItems',
            // UI prefs the renderer persists; without these the keybinding editor
            // and theme-palette dropdown apply live but reset on restart (the
            // writes were silently rejected and only web localStorage kept them).
            'keybindings', 'themePalette',
        ]);
        ipcMain.handle('save-setting', (event, key, value) => {
            if (!RENDERER_WRITABLE_SETTINGS.has(key)) {
                console.warn('[Electron] save-setting rejected non-writable key:', key);
                return false;
            }
            const success = settingsManager.saveSettings({ [key]: value });
            // Rebuild the native menu live when the user changes its customization.
            if (success && key === 'menuHiddenItems') {
                try { createMenu(); } catch (e) { console.error('[Electron] menu rebuild failed:', e); }
            }
            return success ? settingsManager.getSettings() : false;
        });
        ipcMain.handle('logout', () => {
            // Only clear credential-related settings.
            // Preserve backup path, frequency, retention etc — they are NOT sensitive.
            settingsManager.saveSettings({
                rememberMe: false,
                savedPassword: '',
            });
            return true;
        });

        ipcMain.handle('get-plugins', async () => {
            try {
                return readInstalledPlugins();
            } catch (err) {
                console.error('[Electron] Failed to scan plugins:', err);
                return [];
            }
        });

        ipcMain.handle('select-folder', async () => {
            const { dialog } = require('electron');
            const result = await dialog.showOpenDialog(mainWindow || null, {
                properties: ['openDirectory']
            });
            if (result.canceled || result.filePaths.length === 0) return null;
            return result.filePaths[0];
        });

        ipcMain.handle('import-database-dialog', async () => {
            if (!mainWindow) return null;
            const { dialog } = require('electron');
            const result = await dialog.showOpenDialog(mainWindow, {
                title: 'Import Database',
                properties: ['openFile'],
                filters: [{ name: 'Journal Database', extensions: ['tjdb', 'db', 'sqlite'] }]
            });
            if (result.canceled || result.filePaths.length === 0) return null;
            return result.filePaths[0];
        });

        ipcMain.handle('export-database', async () => {
            if (!mainWindow) return false;
            
            const { dialog } = require('electron');
            const fs = require('fs');
            
            const result = await dialog.showSaveDialog(mainWindow, {
                title: 'Export Database',
                defaultPath: path.join(app.getPath('downloads'), 'journal.tjdb'),
                filters: [{ name: 'Journal Database', extensions: ['tjdb'] }]
            });

            if (result.canceled || !result.filePath) return false;

            try {
                const sourcePath = process.env.JOURNAL_DB_PATH || getDatabasePath();
                if (!fs.existsSync(sourcePath)) {
                    throw new Error('Source database not found');
                }

                // Copy main file
                fs.copyFileSync(sourcePath, result.filePath);
                
                // Copy sidecars (WAL/SHM)
                ['wal', 'shm'].forEach(suffix => {
                    const sidecar = `${sourcePath}-${suffix}`;
                    if (fs.existsSync(sidecar)) {
                        fs.copyFileSync(sidecar, `${result.filePath}-${suffix}`);
                    }
                });

                return true;
            } catch (err) {
                console.error('Failed to export database:', err);
                return false;
            }
        });

        ipcMain.handle('store-password', (event, pwd) => {
            if (safeStorage.isEncryptionAvailable()) {
                const encrypted = safeStorage.encryptString(pwd);
                settingsManager.saveSettings({ savedPassword: encrypted.toString('base64'), rememberMe: true });
                return true;
            }
            return false;
        });

        ipcMain.handle('get-password', () => {
            const sett = settingsManager.getSettings();
            if (sett.rememberMe && sett.savedPassword && safeStorage.isEncryptionAvailable()) {
                try {
                    return safeStorage.decryptString(Buffer.from(sett.savedPassword, 'base64'));
                } catch (e) {
                    console.error('Failed to decrypt password. Might be on a different OS/user.', e);
                }
            }
            return null;
        });

        ipcMain.handle('read-file-for-import', async (_event, filePath) => {
            const fs = require('fs');
            const path = require('path');
            try {
                // Defense in depth: the renderer should only invoke this after
                // a user picked a .tjdb file via the OS open-file dialog, but
                // a compromised renderer (e.g. XSS in pasted content) could
                // pass an arbitrary path. Restrict to the journal extension so
                // this IPC can't be abused to exfiltrate other files.
                if (typeof filePath !== 'string' || filePath.length === 0) return null;
                const resolved = path.resolve(filePath);
                if (path.extname(resolved).toLowerCase() !== '.tjdb') {
                    console.warn('[Electron] read-file-for-import rejected non-.tjdb path');
                    return null;
                }
                if (!fs.existsSync(resolved)) return null;
                const buffer = fs.readFileSync(resolved);
                return buffer.toString('base64');
            } catch (err) {
                console.error('[Electron] read-file-for-import failed:', err);
                return null;
            }
        });

        // David RM parity — export current entry to PDF. The renderer
        // resolves the entry's HTML via the /api/entry/:id/print route, then
        // hands the document here. We spawn a hidden BrowserWindow, load the
        // HTML as a data URL, run printToPDF, and write the result to a
        // user-chosen path. Hidden window is destroyed at the end either way.
        ipcMain.handle('save-entry-pdf', async (_event, entryHtml, suggestedName) => {
            const fs = require('fs/promises');
            const { dialog } = require('electron');
            if (typeof entryHtml !== 'string' || entryHtml.length === 0) {
                return { saved: false, reason: 'empty' };
            }
            const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
                defaultPath: `${(suggestedName || 'entry').replace(/[^A-Za-z0-9 _.-]/g, '_')}.pdf`,
                filters: [{ name: 'PDF', extensions: ['pdf'] }],
                title: 'Export Entry to PDF',
            });
            if (result.canceled || !result.filePath) return { saved: false, reason: 'canceled' };

            // Hidden window renders user-authored HTML. Lock it down so a
            // <script> that slipped past the editor sanitizer can't reach Node
            // APIs or the parent window. printToPDF only needs static rendering.
            const printer = new BrowserWindow({
                show: false,
                webPreferences: {
                    offscreen: true,
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: true,
                    javascript: false,
                },
            });
            try {
                await printer.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(entryHtml));
                const pdf = await printer.webContents.printToPDF({
                    printBackground: true,
                    pageSize: 'Letter',
                    margins: { marginType: 'default' },
                });
                await fs.writeFile(result.filePath, pdf);
                return { saved: true, path: result.filePath };
            } catch (err) {
                console.error('[Electron] save-entry-pdf failed:', err);
                return { saved: false, reason: err && err.message ? err.message : 'error' };
            } finally {
                try { printer.destroy(); } catch { /* hidden window already gone */ }
            }
        });


        // Or we can just point to 3000. 
        // For the "sidecar" plan, in DEV we usually point to localhost:3000

        let url;
        if (dev) {
            url = 'http://localhost:3000';
            // We could wait-on here, but scripts usually handle it. 
            // We just create window.
        } else {
            const serverInfo = await startServer();
            url = serverInfo.url;
            serverInstance = serverInfo.server;
        }

        createWindow(url);
        ensureTray(url);

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
            else if (mainWindow) mainWindow.show();
        });

        // ── Auto-update (electron-updater) ─────────────────────────────────────
        // Reads the `publish:` block in electron-builder.yml to find the
        // GitHub Release manifest (latest.yml), downloads the new installer
        // when the released version > the installed one, and prompts the
        // user to relaunch. Disabled in dev so we don't fight the dev server.
        if (!dev) {
            // Avoid blocking startup on a slow network — first check fires
            // 60s after window creation, then every 6 hours.
            const SIX_HOURS_MS_UPDATE = 6 * 60 * 60 * 1000;
            const INITIAL_DELAY_MS = 60_000;
            const checkForUpdates = () => {
                autoUpdater.checkForUpdatesAndNotify().catch(err => {
                    console.error('[Electron] autoUpdater check failed:', err);
                });
            };
            setTimeout(checkForUpdates, INITIAL_DELAY_MS);
            setInterval(checkForUpdates, SIX_HOURS_MS_UPDATE);

            autoUpdater.on('update-downloaded', (info) => {
                console.log('[Electron] Update downloaded:', info?.version);
                if (!mainWindow) return;
                const { dialog } = require('electron');
                dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    buttons: ['Restart now', 'Later'],
                    defaultId: 0,
                    cancelId: 1,
                    title: 'Update ready',
                    message: `TheJournal ${info?.version ?? ''} has been downloaded.`,
                    detail: 'Restart the app to finish installing the update.',
                }).then(({ response }) => {
                    if (response === 0) {
                        autoUpdater.quitAndInstall();
                    }
                });
            });

            autoUpdater.on('error', (err) => {
                console.error('[Electron] autoUpdater error:', err);
            });
        }

        // ── Scheduled background backup ────────────────────────────────────────
        // If auto-backup is enabled, run performAutoBackup every 6 hours so that
        // long-running sessions are covered even if the machine never restarts.
        // Handle is tracked in module scope so it can be cleared on quit.
        const SIX_HOURS_MS = 6 * 60 * 60 * 1000; // 21_600_000 ms
        const initialSettings = settingsManager.getSettings();
        if (initialSettings.autoBackupOnClose) {
            console.log('[Electron] Scheduling background backup every 6 hours.');
            backupIntervalHandle = setInterval(() => {
                performAutoBackup().catch(err =>
                    console.error('[Electron] Background backup error:', err)
                );
            }, SIX_HOURS_MS);
        }

    } catch (err) {
        console.error('Failed to start app:', err);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    if (backupIntervalHandle) {
        clearInterval(backupIntervalHandle);
        backupIntervalHandle = null;
    }
    if (serverInstance) {
        serverInstance.close();
    }
});

app.on('before-quit', (e) => {
    // Real quit in progress — let the window close instead of hiding to tray.
    isQuitting = true;
    // Delegate to the shared performAutoBackup function.
    // Note: before-quit fires synchronously so we cannot await here —
    // the backup copy is synchronous (copyFileSync) and completes before
    // the process exits under normal OS conditions.
    console.log('[Electron] before-quit: triggering auto-backup...');
    performAutoBackup().catch(err =>
        console.error('[Electron] before-quit backup error:', err)
    );
});
