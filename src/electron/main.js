const { app, BrowserWindow, screen, ipcMain, Menu, safeStorage } = require('electron');
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
            try {
                if (!fs.existsSync(filePath)) return null;
                const buffer = fs.readFileSync(filePath);
                return buffer.toString('base64');
            } catch (err) {
                console.error('[Electron] read-file-for-import failed:', err);
                return null;
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
        const SIX_HOURS_MS = 6 * 60 * 60 * 1000; // 21_600_000 ms
        const initialSettings = settingsManager.getSettings();
        if (initialSettings.autoBackupOnClose) {
            console.log('[Electron] Scheduling background backup every 6 hours.');
            setInterval(() => {
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
