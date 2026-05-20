const { app, BrowserWindow, screen, ipcMain, Menu, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const getPort = require('get-port');
const SettingsManager = require('./settings');

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

        console.log('[Electron] ✅ Auto-backup SUCCESS at:', dest);
    } catch (err) {
        console.error('[Electron] ❌ Auto-backup FAILED:', err);
    }
}

async function startServer() {
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

function getPluginDir() {
    return path.join(app.getPath('userData'), 'plugins');
}

function ensurePluginDir() {
    const pluginDir = getPluginDir();
    fs.mkdirSync(pluginDir, { recursive: true });
    return pluginDir;
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

function createWindow(url) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    mainWindow = new BrowserWindow({
        width: Math.floor(width * 0.9),
        height: Math.floor(height * 0.9),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: false,
        backgroundColor: '#111827', // Match bg-bg-app
    });

    mainWindow.loadURL(url);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // M3: lock on minimize. When enabled in settings, hint the renderer
    // to drop session state and route back to /login. The renderer also
    // listens for its own idle timer; this main-process hook covers the
    // case where the OS minimizes the window before the renderer notices.
    mainWindow.on('minimize', () => {
        try {
            const s = settingsManager?.getSettings?.() ?? {};
            if (s.lockOnMinimize && mainWindow) {
                mainWindow.webContents.send('lock-app', { reason: 'minimize' });
            }
        } catch (err) {
            console.error('[Electron] lock-on-minimize hook failed:', err);
        }
    });
}

function createMenu() {
    const { dialog, shell } = require('electron');
    const sendViewAction = (action) => {
        if (mainWindow) mainWindow.webContents.send('view-action', action);
    };

    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Import DB...',
                    click: () => {
                        if (mainWindow) {
                            dialog.showOpenDialog(mainWindow, {
                                properties: ['openFile'],
                                filters: [{ name: 'Database', extensions: ['db', 'sqlite', 'tjdb'] }]
                            }).then(result => {
                                if (!result.canceled && result.filePaths.length > 0) {
                                    mainWindow.webContents.send('import-db', result.filePaths[0]);
                                }
                            });
                        }
                    }
                },
                {
                    label: 'Export DB',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('export-db');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Logout',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('logout-request');
                        }
                    }
                },
                {
                    label: 'Settings',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('open-settings');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Print Entry...',
                    accelerator: process.platform === 'darwin' ? 'Cmd+P' : 'Ctrl+P',
                    click: () => {
                        // The renderer owns the "currently open entry" state.
                        // Asking it to print keeps print-target selection in one place.
                        if (mainWindow) {
                            mainWindow.webContents.send('print-current-entry');
                        }
                    }
                },
                {
                    label: 'Export Entry to PDF...',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('export-current-entry-pdf');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Open Another Journal...',
                    click: async () => {
                        if (!mainWindow) return;
                        const result = await dialog.showOpenDialog(mainWindow, {
                            properties: ['openFile'],
                            filters: [{ name: 'TheJournal database', extensions: ['tjdb'] }],
                            title: 'Open Journal',
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            mainWindow.webContents.send('open-journal', result.filePaths[0]);
                        }
                    }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' }
            ]
        },
        {
            label: 'Plugins',
            submenu: [
                {
                    label: 'Install Plugin...',
                    click: async () => {
                        if (!mainWindow) return;

                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: 'Install Plugin',
                            properties: ['openDirectory'],
                        });

                        if (!result.canceled && result.filePaths.length > 0) {
                            await installPluginFromFolder(result.filePaths[0], dialog);
                        }
                    }
                },
                {
                    label: 'Open Plugins Folder',
                    click: async () => {
                        try {
                            await shell.openPath(ensurePluginDir());
                        } catch (err) {
                            console.error('[Electron] Failed to open plugins folder:', err);
                        }
                    }
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Documentation',
                    click: async () => {
                        try { await shell.openExternal('https://github.com/danielttran/TheJournal#readme'); }
                        catch (err) { console.error('[Electron] Failed to open docs:', err); }
                    }
                },
                {
                    label: 'Keyboard Shortcuts',
                    click: () => {
                        // Routes the renderer to the Settings → Keyboard Shortcuts panel.
                        if (mainWindow) mainWindow.webContents.send('open-settings');
                    }
                },
                {
                    label: 'Plugin API Reference',
                    click: async () => {
                        try { await shell.openExternal('https://github.com/danielttran/TheJournal/blob/main/docs/plugins.md'); }
                        catch (err) { console.error('[Electron] Failed to open plugin docs:', err); }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Report an Issue',
                    click: async () => {
                        try { await shell.openExternal('https://github.com/danielttran/TheJournal/issues/new'); }
                        catch (err) { console.error('[Electron] Failed to open issues:', err); }
                    }
                },
                { type: 'separator' },
                {
                    label: 'About TheJournal',
                    click: () => {
                        const { dialog: aboutDialog, app: aboutApp } = require('electron');
                        aboutDialog.showMessageBox(mainWindow ?? undefined, {
                            type: 'info',
                            title: 'About TheJournal',
                            message: 'TheJournal',
                            detail: `Version ${aboutApp.getVersion()}\n\nA local-first encrypted journaling app with DavidRM "The Journal" parity.\n\nPlugins and keyboard shortcuts are configurable from the Settings menu.`,
                            buttons: ['OK'],
                        });
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                {
                    label: 'Search…',
                    accelerator: 'CmdOrCtrl+F',
                    click: () => sendViewAction('search')
                },
                {
                    label: 'Templates…',
                    accelerator: 'CmdOrCtrl+Shift+T',
                    click: () => sendViewAction('templates')
                },
                {
                    label: 'Writing Prompts…',
                    accelerator: 'CmdOrCtrl+Shift+P',
                    click: () => sendViewAction('prompts')
                },
                {
                    label: 'Focus Mode',
                    accelerator: 'F11',
                    click: () => sendViewAction('focus')
                },
                {
                    label: 'Toggle Split',
                    accelerator: 'CmdOrCtrl+\\',
                    click: () => sendViewAction('split')
                },
                { type: 'separator' },
                {
                    // No accelerator — Ctrl+Z is owned by Edit > Undo (role: 'undo').
                    // TipTap also handles Ctrl+Z natively inside the editor.
                    // This item lets users trigger editor undo from the menu by mouse.
                    label: 'Undo',
                    click: () => sendViewAction('undo')
                },
                {
                    label: 'Redo',
                    click: () => sendViewAction('redo')
                },
                {
                    label: 'Inline Code',
                    accelerator: 'CmdOrCtrl+E',
                    click: () => sendViewAction('inline-code')
                },
                {
                    label: 'Checklist',
                    click: () => sendViewAction('checklist')
                },
                {
                    label: 'Highlight',
                    click: () => sendViewAction('highlight')
                },
                {
                    label: 'Horizontal Rule',
                    click: () => sendViewAction('hr')
                },
                {
                    label: 'Upload Image from PC…',
                    accelerator: 'CmdOrCtrl+Shift+I',
                    click: () => sendViewAction('image-upload')
                },
                { type: 'separator' },
                {
                    label: 'Toggle Theme',
                    accelerator: 'CmdOrCtrl+T',
                    click: () => {
                        if (mainWindow) {
                            console.log('Sending toggle-theme event');
                            mainWindow.webContents.send('toggle-theme');
                        }
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
    try {
        // Initialize settings FIRST — requires app to be ready for getPath('userData')
        settingsManager = new SettingsManager();

        createMenu();

        // Register IPC Handlers
        ipcMain.handle('get-settings', () => settingsManager.getSettings());
        ipcMain.handle('save-setting', (event, key, value) => {
            const success = settingsManager.saveSettings({ [key]: value });
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

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
        });

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
    // Delegate to the shared performAutoBackup function.
    // Note: before-quit fires synchronously so we cannot await here —
    // the backup copy is synchronous (copyFileSync) and completes before
    // the process exits under normal OS conditions.
    console.log('[Electron] before-quit: triggering auto-backup...');
    performAutoBackup().catch(err =>
        console.error('[Electron] before-quit backup error:', err)
    );
});
