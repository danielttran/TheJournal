const { app, BrowserWindow, screen, ipcMain, Menu, safeStorage } = require('electron');
const path = require('path');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const getPort = require('get-port');
const SettingsManager = require('./settings');

const dev = process.env.NODE_ENV !== 'production';
const dir = path.join(__dirname, '../../'); // Adjust based on where main.js is (src/electron/main.js -> root is ../../)

const settingsManager = new SettingsManager();
const settings = settingsManager.getSettings();

async function startServer() {
    // Set DB Path for Next.js to use
    if (!dev) {
        const dbPath = settings.dbPath === 'default'
            ? path.join(app.getPath('userData'), 'journal.tjdb')
            : settings.dbPath;

        process.env.JOURNAL_DB_PATH = dbPath;
        console.log('Database Path:', process.env.JOURNAL_DB_PATH);
    }

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
                    label: 'Undo',
                    accelerator: 'CmdOrCtrl+Z',
                    click: () => sendViewAction('undo')
                },
                {
                    label: 'Redo',
                    accelerator: 'CmdOrCtrl+Shift+Z',
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
            const result = await require('electron').dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory']
            });
            if (result.canceled || result.filePaths.length === 0) return null;
            return result.filePaths[0];
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

        // If dev, we assume user ran 'npm run dev' separately or we wait for it
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
    console.log('[Electron] App closing, checking backup settings...');
    const s = settingsManager.getSettings();
    console.log('[Electron] Settings:', { autoBackup: s.autoBackupOnClose, path: s.backupPath });

    if (s.autoBackupOnClose && s.backupPath) {
        const fs = require('fs');
        let dbPath;

        if (dev) {
            dbPath = path.join(dir, 'journal.tjdb');
            if (!fs.existsSync(dbPath)) dbPath = path.join(app.getPath('userData'), 'journal.tjdb');
        } else {
            dbPath = process.env.JOURNAL_DB_PATH || path.join(app.getPath('userData'), 'journal.tjdb');
        }

        console.log('[Electron] Attempting backup from:', dbPath);

        if (fs.existsSync(dbPath)) {
            try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupName = `backup-${timestamp}.tjdb`;
                
                // DATA RETENTION LOGIC
                const maxBackups = s.retentionCount > 0 ? s.retentionCount : 3;
                
                if (!fs.existsSync(s.backupPath)) {
                    fs.mkdirSync(s.backupPath, { recursive: true });
                }

                // Fetch all .tjdb files
                const files = fs.readdirSync(s.backupPath);
                const tjdbFiles = [];
                
                for (const file of files) {
                    if (file.endsWith('.tjdb')) {
                        const fullPath = path.join(s.backupPath, file);
                        const stat = fs.statSync(fullPath);
                        tjdbFiles.push({ name: file, path: fullPath, ctimeMs: stat.ctimeMs });
                    }
                }
                
                // Sort oldest to newest
                tjdbFiles.sort((a, b) => a.ctimeMs - b.ctimeMs);
                
                // Delete older files until we have exactly (maxBackups - 1) left
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
                console.log('[Electron] ✅ Auto-backup SUCCESS at:', dest);
            } catch (err) {
                console.error('[Electron] ❌ Auto-backup FAILED:', err);
            }
        } else {
            console.error('[Electron] ❌ Source DB not found at:', dbPath);
        }
    }
});
